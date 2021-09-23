const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);

const CUSTOMER_TABLE = process.env.CUSTOMER_TABLE;

exports.lambdaHandler = async (event, context) => {

    const method = event.requestContext.http.method;
    const action = event.pathParameters.action;
    const customerId = event.pathParameters.customerId;

    let result;

    switch(method) {
        case 'GET' : switch(action) {
            case 'describe':
                result = await describeCustomer(customerId);
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

async function describeCustomer(customerId) {
    const params = {
        Statement: `SELECT *
        FROM "${CUSTOMER_TABLE}"
        WHERE customerId = '${customerId}'`
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
