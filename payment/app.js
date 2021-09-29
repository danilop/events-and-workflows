const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const { 
    v4: uuidv4,
} = require('uuid');

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);
const ebClient = new EventBridgeClient();

const EVENT_SOURCE="Payment";
const EVENT_BUS = process.env.EVENT_BUS;
const PAYMENT_TABLE = process.env.PAYMENT_TABLE;
const PAYMENT_FAIL_PROBABILITY = process.env.PAYMENT_FAIL_PROBABILITY; // Between 0 and 1

exports.lambdaHandler = async (event, context) => {

    const eventType = event['detail-type'];

    if (eventType !== undefined) {

        // EventBridge Invocation
        const order = event.detail;

        switch(eventType) {
            case 'DeliveryEstimated':
                const totalPrice = order.item.price + order.delivery.price;
                await processPayment(await makePayment(totalPrice),
                    'PaymentMade', 'PaymentFailed', order, 'payment');
                break;
            case 'ItemReturned':
                await processPayment(await cancelPayment(order.order.paymentId),
                    'PaymentCanceled', 'ErrorPaymentCanceled', order, 'payment');
                break;
                default:
                console.error(`Action '${action}' not implemented.`);
        }
    } else {

        // API Gateway Invocation
        const method = event.requestContext.http.method;
        const action = event.pathParameters.action;
        const what = event.pathParameters.what;

        let result;

        switch(method) {
            case 'GET' : switch(action) {
                case 'pay':
                    result = await makePayment(what);
                    break;
                case 'describe':
                    result = await describePayment(what);
                    break;
                case 'cancel':
                    result = await cancelPayment(what);
                    break;
                default:
                    return {
                        statusCode: 501,
                        body: `Action '${action}' not implemented.`
                    };
            }
        }

        const response = {
            statusCode: result.length > 0 ? (result[0].status != 'FAILED' ? 201 : 401) : 404,
            body: result.length > 0? JSON.stringify(result[0]) : "Not Found"
        };
    
        return response;
    }
};

function shouldPaymentFail() {
    return Math.random() < PAYMENT_FAIL_PROBABILITY;
}

async function describePayment(paymentId) {
    const params = {
        Statement: `SELECT *
        FROM "${PAYMENT_TABLE}"
        WHERE paymentId = '${paymentId}'`
    };
    const payments = await executeStatement(params);

    return payments;
}

async function makePayment(amount) {

    const paymentId = uuidv4();
    const failed = shouldPaymentFail();
    const status = failed ? 'FAILED' : "PAID";

    const payment =
        `{'paymentId' : '${paymentId}', 'paymentMethod' : 'CREDIT_CARD',
        'amount' : ${amount}, 'status' : '${status}'}`;

    const params = {
        Statement: `INSERT INTO "${PAYMENT_TABLE}" VALUE ${payment}`
    }
    await executeStatement(params);

    return {
        paymentId: paymentId,
        paymentMethod: 'CREDIT_CARD',
        amount: amount,
        status: status
    }
}

async function cancelPayment(paymentId) {

    const params = {
        Statement: `UPDATE "${PAYMENT_TABLE}"
        SET status = 'CANCELED'
        WHERE paymentId = '${paymentId}'
        AND status = 'PAID'
        RETURNING ALL NEW *`
    }
    const payments = await executeStatement(params);

    console.log(payments);

    return payments;
}

async function processPayment(payment, OK, KO, output, add) {
    if (add !== undefined) {
        output[add] = payment;
    }
    if (payment.length > 0 || payment.status == 'PAID') {
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
