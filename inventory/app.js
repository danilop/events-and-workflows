const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);
const ebClient = new EventBridgeClient();

const EVENT_SOURCE="Inventory";
const EVENT_BUS = process.env.EVENT_BUS;
const INVENTORY_TABLE = process.env.INVENTORY_TABLE;

exports.lambdaHandler = async (event, context) => {

    const eventType = event['detail-type'];

    if (eventType !== undefined) {

        // EventBridge Invocation
        const order = event.detail;

        switch(eventType) {
            case 'OrderCreated':
                await processResult(await reserveItem(order.itemId),
                    'ItemReserved', 'ItemNotAvailable',
                    order);
                break;
            case 'PaymentFailed':
                await processResult(await unreserveItem(order.itemId),
                    'ItemUnreserved', 'ErrorItemUnreserved',
                    order);
                break;
            case 'PaymentMade':
                await processResult(await removeReservedItem(order.itemId),
                    'ItemRemoved', 'ErrorItemRemoved',
                    order);
                break;        
            case 'OrderCanceled':
                await processResult(await returnItemAsAvailable(order.order.itemId),
                    'ItemReturned', 'ErrorItemReturned',
                    order);
                break;
            case 'ItemReserved':
                await processResult(await describeItem(order.itemId),
                    'ItemDescribed', 'ErrorItemDescribed',
                    order, 'item');
                break;
            default:
                console.error(`Action '${action}' not implemented.`);
        }
    } else {

        // API Gateway Invocation
        const method = event.requestContext.http.method;
        const action = event.pathParameters.action;
        const itemId = event.pathParameters.itemId;
        
        let result;

        switch(method) {
            case 'GET' : switch(action) {
                case 'describe':
                    result = await describeItem(itemId);
                    break;
                case 'reserve':
                    result = await reserveItem(itemId);
                    break;
                case 'unreserve':
                    result = await unreserveItem(itemId);
                    break;
                case 'remove':
                    result = await removeReservedItem(itemId);
                    break;
                case 'return':
                    result = await returnItemAsAvailable(itemId);
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

async function describeItem(itemId) {
    const params = {
        Statement: `SELECT *
        FROM "${INVENTORY_TABLE}"
        WHERE itemId = '${itemId}'`
    };
    return await executeStatement(params);
}

async function reserveItem(itemId) {
    const params = {
        Statement: `UPDATE "${INVENTORY_TABLE}"
        SET available=available-1
        SET reserved=reserved+1
        WHERE itemId = '${itemId}' AND available > 0
        RETURNING MODIFIED NEW *`
    }
    return await executeStatement(params);
}

async function unreserveItem(itemId) {
    const params = {
        Statement: `UPDATE "${INVENTORY_TABLE}"
        SET available=available+1
        SET reserved=reserved-1
        WHERE itemId = '${itemId}' AND reserved > 0
        RETURNING MODIFIED NEW *`
    }
    return await executeStatement(params);
}

async function removeReservedItem(itemId) {
    const params = {
        Statement: `UPDATE "${INVENTORY_TABLE}"
        SET reserved=reserved-1
        WHERE itemId = '${itemId}' AND reserved > 0
        RETURNING MODIFIED NEW *`
    }
    return await executeStatement(params);
}

async function returnItemAsAvailable(itemId) {
    const params = {
        Statement: `UPDATE "${INVENTORY_TABLE}"
        SET available=available+1
        WHERE itemId = '${itemId}'
        RETURNING MODIFIED NEW *`
    }
    return await executeStatement(params);
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
    return [response];
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
