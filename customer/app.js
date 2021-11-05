const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);
const ebClient = new EventBridgeClient();

const EVENT_SOURCE="Customer";
const EVENT_BUS = process.env.EVENT_BUS;
const CUSTOMER_TABLE = process.env.CUSTOMER_TABLE;

exports.lambdaHandler = async (event, context) => {

    const eventType = event['detail-type'];

    if (eventType !== undefined) {

        // EventBridge Invocation
        const order = event.detail;

        switch(eventType) {
            case 'ItemDescribed':
                await processResult(await describeCustomer(order.customerId),
                    "CustomerDescribed", "ErrorCustomerDescribed",
                    order, "customer");
                break;
            default:
                console.error(`Event '${eventType}' not implemented.`);
        }
    } else {

        // API Gateway Invocation
        const method = event.requestContext.http.method;
        const action = event.pathParameters.action;
        const customerId = event.pathParameters.customerId;

        let result;

        switch(method) {
            case 'GET' :
                switch(action) {
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
            body: result.length > 0? JSON.stringify(result[0]) : "Not Found"
        };
    
        return response;
    }
};

async function describeCustomer(customerId) {
    const params = {
        Statement: `SELECT *
        FROM "${CUSTOMER_TABLE}"
        WHERE customerId = '${customerId}'`
    };
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
