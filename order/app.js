const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);
const ebClient = new EventBridgeClient();

const EVENT_SOURCE="Order";
const EVENT_BUS = process.env.EVENT_BUS;
const ORDER_TABLE = process.env.ORDER_TABLE;

exports.lambdaHandler = async (event, context) => {

    let result;

    const eventType = event['detail-type'];

    if (eventType !== undefined) {

        // EventBridge Invocation
        const order = event.detail;

        switch(eventType) {
            case 'CreateOrder':
                await createOrder(order.customerId, order.itemId);
                break;
            case 'DeliveryWasDelivered':
                await processResult(await updateOrder('DELIVERED', order),
                    'OrderDelivered', 'ErrorOrderDelivered', order);
                break;
            case 'DeliveryWasCanceled':
                await processResult(await updateOrder('DELIVERY_CANCELED', order),
                    'OrderCanceled', 'ErrorOrderCanceled', order, 'order');
                break;
            // Events catched to store/update the order table
            case 'PaymentMade':
                await storeOrder('PAID', order);
                break;
            case 'PaymentFailed':
                await storeOrder('PAYMENT_FAILED', order);
                break;
            case 'PaymentCanceled':
                await updateOrder('PAYMENT_CANCELED', order);
                break;
            case 'DeliveryStarted':
                await updateOrder('DELIVERING', order);
                break;
            default:
                console.error(`Action '${action}' not implemented.`);
        }
    } else {

        // API Gateway Invocation
        const method = event.requestContext.http.method;
        const action = event.pathParameters.action;
        const customerId = event.pathParameters.customerId;
        const what = event.pathParameters.what;
    
        switch(method) {
            case 'GET' : switch(action) {
                case 'create':
                    result = await createOrder(customerId, what);
                    break;
                case 'describe':
                    result = await describeOrder(customerId, what);
                    break;
                case 'delivered':
                    result = await delivered(customerId, what);
                    break;
                case 'cancel':
                    result = await cancelOrder(customerId, what);
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

async function createOrder(customerId, itemId) {
    const orderId = new Date().toISOString();
    const order = {
        customerId,
        orderId,
        itemId
    };
    await sendEvent("OrderCreated", order);
    return [order];
}

async function describeOrder(customerId, orderId) {
    const params = {
        Statement: `SELECT *
        FROM "${ORDER_TABLE}"
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'`
    };
    return await executeStatement(params)
}

async function storeOrder(orderStatus, order) {

    const orderDate = new Date().toISOString();
    const dbOrder = `{'customerId' : '${order.customerId}',
    'orderId' : '${order.orderId}', 'orderStatus' : '${orderStatus}',
    'itemId' : '${order.itemId}', 'itemPrice' : ${order.item.price},
    'deliveryPrice': ${order.delivery.price}, 'totalPrice': ${order.payment.amount},
    'paymentId': '${order.payment.paymentId}', 'deliveryAddress': '${order.customer.address}',
    'orderDate': '${orderDate}', 'updateDate': '${orderDate}'}`;
    const params = {
        Statement: `INSERT INTO "${ORDER_TABLE}" VALUE ${dbOrder}`
    }

    await executeStatement(params);

    return;
}

async function updateOrder(orderStatus, order) {

    const updateDate = new Date().toISOString();
    const params = {
        Statement: `UPDATE "${ORDER_TABLE}"
        SET orderStatus = '${orderStatus}', updateDate = '${updateDate}'
        WHERE customerId = '${order.customerId}'
        AND orderId = '${order.orderId}'
        RETURNING ALL NEW *`
    }
    const updates = await executeStatement(params);

    console.log(updates);

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
    console.log(params);
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
