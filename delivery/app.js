const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");
const { LocationClient, SearchPlaceIndexForTextCommand, CalculateRouteCommand } = require("@aws-sdk/client-location");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);
const locationClient = new LocationClient();

const PLACE_INDEX = process.env.PLACE_INDEX;
const ROUTE_CALCULATOR = process.env.ROUTE_CALCULATOR;
const DELIVERY_TABLE = process.env.DELIVERY_TABLE;

const START_ADDRESS = '60 Holborn Viaduct, London EC1A 2FD, UK';

var startAddressPlace;

exports.lambdaHandler = async (event, context) => {

    const method = event.requestContext.http.method;
    const action = event.pathParameters.action;
    const customerId = event.pathParameters.customerId;
    const orderId = event.pathParameters.orderId;
    const address = event.pathParameters.address;

    if (startAddressPlace === undefined) {
        startAddressPlace = await getPlaceFromAddress(START_ADDRESS);
    }

    let response;

    switch(method) {
        case 'GET' : switch(action) {
            case 'start':
                response = await startDelivery(customerId, orderId, address);
                break;
            case 'describe':
                response = await describeDelivery(customerId, orderId);
                break;
            case 'cancel':
                response = await cancelDelivery(customerId, orderId);
                break;
            case 'delivered':
                response = await delivered(customerId, orderId);
                break;
            case 'estimate':
                response = await estimateDelivery(address);
                break;
            default:
                response = {
                    statusCode: 501,
                    body: `Action '${action}' not implemented.`
                };
        }
    }

    return response;
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
    return {
        statusCode: 200,
        body: JSON.stringify(delivery)
    };
}

async function describeDelivery(customerId, orderId) {
    const params = {
        Statement: `SELECT *
        FROM "${DELIVERY_TABLE}"
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'`
    };
    const deliveries = await executeStatement(params);

    return {
        statusCode: deliveries.length > 0 ? 200 : 404,
        body: JSON.stringify(deliveries)
    }
}

async function startDelivery(customerId, orderId, address) {

    const status = 'DELIVERING';
    const routeSummary = await getRouteSummaryFor(address);

    const delivery =
        `{'customerId' : '${customerId}', 'orderId' : '${orderId}',
        'address' : '${address}', 'status' : '${status}',
        'price' : ${routeSummary.price}}`;
    console.log(delivery);
    const params = {
        Statement: `INSERT INTO "${DELIVERY_TABLE}" VALUE ${delivery}`
    }
    await executeStatement(params);

    return {
        statusCode: 201,
        body: JSON.stringify({
            customerId: customerId,
            orderId: orderId,
            address: address,
            status: status
        })
    }
}

async function cancelDelivery(customerId, orderId) {

    const params = {
        Statement: `UPDATE "${DELIVERY_TABLE}"
        SET status = 'CANCELED'
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'
        RETURNING MODIFIED NEW *`
    }
    const updates = await executeStatement(params);

    return {
        statusCode: updates.length > 0 ? 200 : 404,
        body: JSON.stringify(updates)
    }
}

async function delivered(customerId, orderId) {

    const params = {
        Statement: `UPDATE "${DELIVERY_TABLE}"
        SET status = 'DELIVERED'
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'
        RETURNING MODIFIED NEW *`
    }
    const updates = await executeStatement(params);

    return {
        statusCode: updates.length > 0 ? 200 : 404,
        body: JSON.stringify(updates)
    }
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
