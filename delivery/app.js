const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");
const { LocationClient, SearchPlaceIndexForTextCommand, CalculateRouteCommand } = require("@aws-sdk/client-location");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);
const locationClient = new LocationClient();
const ebClient = new EventBridgeClient();

const EVENT_SOURCE="Delivery";
const EVENT_BUS = process.env.EVENT_BUS;
const PLACE_INDEX = process.env.PLACE_INDEX;
const ROUTE_CALCULATOR = process.env.ROUTE_CALCULATOR;
const DELIVERY_TABLE = process.env.DELIVERY_TABLE;

const START_ADDRESS = '60 Holborn Viaduct, London EC1A 2FD, UK';

var startAddressPlace;

exports.lambdaHandler = async (event, context) => {

    if (startAddressPlace === undefined) {
        startAddressPlace = await getPlaceFromAddress(START_ADDRESS);
    }

    const eventType = event['detail-type'];

    if (eventType !== undefined) {

        // EventBridge Invocation
        const order = event.detail;

        switch(eventType) {
            case 'CustomerDescribed':
                await processResult(await estimateDelivery(order.customer.address),
                    "DeliveryEstimated", "ErrorDeliveryEstimated",
                    order, "delivery");
                break;
            case 'ItemRemoved':
                await processResult(await startDelivery(order.customerId, order.orderId, order.customer.address),
                    "DeliveryStarted", "ErrorDeliveryStarted",
                    order, "delivery");
                break;
            case 'Delivered':
                await processResult(await delivered(order.customerId, order.orderId),
                    "DeliveryWasDelivered", "ErrorDeliveryWasDelivered",
                    order, "delivery");
                break;
            case 'DeliveryCanceled':
                await processResult(await cancelDelivery(order.customerId, order.orderId),
                    "DeliveryWasCanceled", "ErrorDeliveryWasCanceled",
                    order, "delivery");
                break;
            default:
                console.error(`Event '${eventType}' not implemented.`);
        }
    } else {

        // API Gateway Invocation
        const method = event.requestContext.http.method;
        const action = event.pathParameters.action;
        const customerId = event.pathParameters.customerId;
        const orderId = event.pathParameters.orderId;
        const address = event.pathParameters.address;

        let result;

        switch(method) {
            case 'GET' : switch(action) {
                case 'start':
                    result = await startDelivery(customerId, orderId, address);
                    break;
                case 'describe':
                    result = await describeDelivery(customerId, orderId);
                    break;
                case 'cancel':
                    result = await cancelDelivery(customerId, orderId);
                    break;
                case 'delivered':
                    result = await delivered(customerId, orderId);
                    break;
                case 'estimate':
                    result = await estimateDelivery(address);
                    break;
                default:
                    return {
                        statusCode: 501,
                        body: `Action '${action}' not implemented.`
                    };
            }
        }

        const response = {
            statusCode: result.length > 0 ? 200 : 404,
            body: result.length > 0? JSON.stringify(result[0]) : "Not Found"
        };
    
        return response;
    }
};

async function getPlaceFromAddress(address) {
    const params = {
        IndexName: PLACE_INDEX,
        Text: address
    }
    const response = await locationClient.send(new SearchPlaceIndexForTextCommand(params));
    console.log(response);
    return response.Results[0].Place;
}

async function getRouteForAddress(address) {
    const destinationPlace = await getPlaceFromAddress(address);
    const params = {
        CalculatorName: ROUTE_CALCULATOR,
        DeparturePosition: startAddressPlace.Geometry.Point,
        DestinationPosition: destinationPlace.Geometry.Point
    }
    const response = await locationClient.send(new CalculateRouteCommand(params));
    console.log(response);
    return response;
}

async function getRouteSummaryFor(address) {
    const route = await getRouteForAddress(address);
    const routeSummary = route.Summary;
    routeSummary.price = Math.round(routeSummary.DurationSeconds) / 100; // Be careful when rounding money values!
    return routeSummary;
}

async function estimateDelivery(address) {
    const delivery = await getRouteSummaryFor(address);
    return [delivery];
}

async function describeDelivery(customerId, orderId) {
    const params = {
        Statement: `SELECT *
        FROM "${DELIVERY_TABLE}"
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'`
    };
    const deliveries = await executeStatement(params);

    return deliveries;
}

async function startDelivery(customerId, orderId, address) {

    const deliveryStatus = 'DELIVERING';
    const routeSummary = await getRouteSummaryFor(address);

    const delivery =
        `{'customerId' : '${customerId}', 'orderId' : '${orderId}',
        'address' : '${address}', 'deliveryStatus' : '${deliveryStatus}',
        'price' : ${routeSummary.price}}`;
    const params = {
        Statement: `INSERT INTO "${DELIVERY_TABLE}" VALUE ${delivery}`
    }
    await executeStatement(params);

    return [{
        customerId: customerId,
        orderId: orderId,
        address: address,
        deliveryStatus: deliveryStatus
    }];
}

async function cancelDelivery(customerId, orderId) {

    const params = {
        Statement: `UPDATE "${DELIVERY_TABLE}"
        SET deliveryStatus = 'CANCELED'
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'
        RETURNING MODIFIED NEW *`
    }
    const updates = await executeStatement(params);

    return updates;
}

async function delivered(customerId, orderId) {

    const params = {
        Statement: `UPDATE "${DELIVERY_TABLE}"
        SET deliveryStatus = 'DELIVERED'
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'
        RETURNING MODIFIED NEW *`
    }
    const updates = await executeStatement(params);

    return updates;
}

async function processResult(result, OK, KO, output, add) {
    if (result.length > 0) {
        if (add !== undefined) {
            output[add] = result[0];
        }
        await sendEvent(OK, output);
    } else {
        await sendEvent(KO, output);
    }
}

async function sendEvent(type, detail) {
    const params = {
        "Entries": [ 
           { 
              "Detail": JSON.stringify(detail),
              "DetailType": type,
              "EventBusName": EVENT_BUS,
              "Source": EVENT_SOURCE
           }
        ]
    };
    const response = await ebClient.send(new PutEventsCommand(params));
    return response;
}

async function executeStatement(params) {
    try {
        const { Items } = await ddbDocClient.send(new ExecuteStatementCommand(params));
        return Items;
    } catch (err) {
        console.error(err);
        if (err.name == 'ConditionalCheckFailedException') {
            return [];
        } else {
            throw err
        }
    }
}
