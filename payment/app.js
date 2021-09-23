const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, ExecuteStatementCommand } = require("@aws-sdk/lib-dynamodb");

const { 
    v4: uuidv4,
} = require('uuid');

const ddbClient = new DynamoDB();
const ddbDocClient = DynamoDBDocument.from(ddbClient);

const PAYMENT_TABLE = process.env.PAYMENT_TABLE;

const PAYMENT_FAIL_PROBABILITY = process.env.PAYMENT_FAIL_PROBABILITY; // Between 0 and 1

exports.lambdaHandler = async (event, context) => {

    const method = event.requestContext.http.method;
    const action = event.pathParameters.action;
    const what = event.pathParameters.what;

    let response;

    switch(method) {
        case 'GET' : switch(action) {
            case 'pay':
                response = await makePayment(what);
                break;
            case 'describe':
                response = await describePayment(what);
                break;
            case 'cancel':
                response = await cancelPayment(what);
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

    return {
        statusCode: payments.length > 0 ? 200 : 404,
        body: JSON.stringify(payments)
    }
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
        statusCode: failed ? 401 : 201,
        body: JSON.stringify({
            paymentId: paymentId,
            paymentMethod: 'CREDIT_CARD',
            amount: amount,
            status: status
        })
    }
}

async function cancelPayment(paymentId) {

    const params = {
        Statement: `UPDATE "${PAYMENT_TABLE}"
        SET status = 'CANCELED'
        WHERE paymentId = '${paymentId}'
        AND status = 'PAID'
        RETURNING MODIFIED NEW *`
    }
    const payments = await executeStatement(params);

    return {
        statusCode: payments.length > 0 ? 200 : 404,
        body: JSON.stringify(payments)
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
