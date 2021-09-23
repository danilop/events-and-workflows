const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);

const ORDER_TABLE = process.env.ORDER_TABLE;

exports.lambdaHandler = async (event, context) => {

    const method = event.requestContext.http.method;
    const action = event.pathParameters.action;
    const customerId = event.pathParameters.customerId;
    const orderId = event.pathParameters.orderId;

    let result;

    switch(method) {
        case 'GET' : switch(action) {
            case 'describe':
                result = await describeOrder(customerId, orderId);
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

async function describeOrder(customerId, orderId) {
    const params = {
        Statement: `SELECT *
        FROM "${ORDER_TABLE}"
        WHERE customerId = '${customerId}'
        AND orderId = '${orderId}'`
    };
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
