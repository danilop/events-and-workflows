const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);

const INVENTORY_TABLE = process.env.INVENTORY_TABLE;

exports.lambdaHandler = async (event, context) => {

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
        body: JSON.stringify(result)
    };

    return response;
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
