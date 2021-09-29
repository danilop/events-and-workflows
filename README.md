# Events and Workflows

Start by building and deploying the projext:

```bash
sam build -p # Parallel build

sam deploy -g # Guided deployment,
```

Next times, when you update the code, you can build and deploy with:

```bash
sam build -c -p && sam deploy # Parallel build caching previous builds
```

When asked about functions that may not have authorization defined, answer (y)es. The access to those functions will be open to anyone, so keep the app deployed only for the time you need this demo running. To delete the app:

```bash
sam delete
```

# Services

Customer - customer information such as name, address, and email
Order - to create an order orchestrating all other services, and describe the order status
Inventory - to store inventory information of items to sell
Payment - to make and cancel payments, it can randomly fail (see Demo below)
Delivery - to estimate distance and cost of a delivery, and to start, complete, or cancel a delivery

Event Store - to store all events, used only by the event-driven approach 

Add - utility function to add two numbers, used only by the order create workflow

# API Operations

On the Amazon API Gateway REST API endpoint (starting a workflow):

```
GET /order/create/{customerId}/{orderId} # To start a create order workflow (using [AWS Step Functions](https://aws.amazon.com/step-functions/))
```
On the Amazon API Gateway HTTP API endpoint:

```
GET /customer/describe/{customerId}
GET /order/create/{customerId}/{itemId} # To start an event-driven order creation (using [Amazon EventBridge](https://aws.amazon.com/eventbridge/))
GET /order/describe/{customerId}/{orderId}
GET /inventory/describe/{itemId}
GET /inventory/reserve/{itemId}
GET /inventory/unreserve/{itemId}
GET /inventory/remove/{itemId}
GET /inventory/return/{itemId}
GET /payment/pay/{amount}
GET /payment/cancel/{paymentId}
GET /payment/describe/{paymentId}
GET /delivery/start/{customerId}/{orderId}/{address}
GET /delivery/describe/{customerId}/{orderId}
GET /delivery/cancel/{customerId}/{orderId}
GET /delivery/delivered/{customerId}/{orderId}
GET /delivery/estimate/{address}
```

# Workflow Orchestration Demo - Using [AWS Step Functions](https://aws.amazon.com/step-functions/)

Load the sample data in the `data` directory, use the same stack name you entered for `sam deploy`:

```bash
./load.sh <stack-name>
```

To create an order from the AWS Step Functions console, use this input to start the execution of the state machine (see the `orderCreateWorkflowInput.json` file in the `data` directory):

```json
{
	"customerId": "customer-1",
	"itemId": "item-1"
}
```

To create an order from the command line (use your CreateOrderApi endpoint in the CloudFromation outputs):

```bash
curl -X POST -d '{"customerId":"customer-1","itemId":"item-1"}' -H "Content-Type: application/json" <CreateOrderApi>
```

An order may fail immediately if there is no availability for an item. You can reload the sample data again to reset availabilities for a demo.

The Payment service randomly fails with probability set in the PAYMENT_FAIL_PROBABILITY environment variable. By default that's equal to 0.2 (20% probability).

If Payment is successful, you can complete the order by setting it DELIVERED or CANCELED.

In the Executions section of the AWS Step Functions console, look for the "Step input" of the last green task (it should be the "Delivering?" task). Copy the value of the `orderId` (something similar to "2021-09-23T13:15:06.510Z") and use it together with the `customerId` to call the Delivery service:

```bash
curl -i <DeliveryApi>/delivered/<customerId>/<orderId>
```

For example:

```bash
curl -i https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com/delivery/delivered/customer-1/2021-09-23T13:15:06.510Z
```

To check the order status (works only when in delivery) :

```bash
curl -i <OrderApi>/describe/<customerId>/<orderId>
```

For example:

curl -i https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com/order/describe/customer-1/2021-09-23T13:15:06.510Z

To cancel the delivery, replace `delivered` with `cancel`.

```bash
curl -i <DeliveryApi>/cancel/<customerId>/<orderId>
```

For example:

```bash
curl -i https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com/delivery/cancel/customer-1/2021-09-23T13:15:06.510Z
```

You can check again the order status to see that is now delivered or canceled.

If the order is canceled, the payment is canceled to and the item is returned to the inventory.

# Event-Driven Choreography Demo – Using [Amazon EventBridge](https://aws.amazon.com/eventbridge/)

Load the sample data in the `data` directory, use the same stack name you entered for `sam deploy`:

```bash
./load.sh <stack-name>
```

Create an order for `customer-1` buing `item-1` calling the Create Order API:

curl -i https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com/order/create/customer-1/item-1

From the output of the command, write down the `customerId` and the `orderId`, they together identify a specific order.

## EventStoreFunction logs

Look at the logs of the `EventStoreFunction` Lambda function. The actual name of the function will be in the form `<stack-name>-EventStoreFunction-<unique-ID>`. To find the logs, in the [Lambda console](https://console.aws.amazon.com/lambda/), select the function, then the **Monitor** tab, then choose **View logs in CloudWatch**. Note that there are no logs before the first execution of a function.

Close the left pad and choose **View as text**. You can see all the event published by different services processing the order. Now there is only an order. When there are more than one order in the logs, you can filter by `orderId`, for example `"2021-09-29T16:50:20.784Z"`, including the double quotes at the start and at the end.

In order, the events for the order you created are:
- `OrderCreated` (from the Order service)
- `ItemReserved` (from the Inventory service)
- `ItemDescribed` (from the Inventory service)
- `CustomerDescribed` (from the Customer service)
- `DeliveryEstimated` (from the Delivery service)
- `PaymentMade` or `PaymentFailed` (from the Payment service)

The Payment service fails with a probability passed to the Lambda `PaymentFunction` in an environment variable (`PAYMENT_FAIL_PROBABILITY`) that by default has value `0.2` (20% probability to fail). You can edit the variable in the Lambda console.

## Payment successful

In case you find the PaymentMade event, the next events are:
- ItemRemoved (from the Inventory service)
- DeliveryStarted (from the Delivery Service)

### InventoryTable content

Look at the **Items** of the `InventoryTable` in the [DynamoDB console](https://console.aws.amazon.com/dynamodb). The actual name of the table will be in the form `<stack-name>-InventoryTable-<unique-ID>`. Note that the table is empty before the first order is created.

If the order was created successfully, you should have an item with status `DELIVERING`.

### Completing order delivery

To move forward when a delivery starts, you need to send an event to report if the delivery has been successful (`Delivered`) or not (`DeliveryCancel`).

In the [EventBridge console](https://console.aws.amazon.com/events/), choose **Event buses** and then the `AppEventBus-<stack-name>` custom event bus. Then, choose **Send events**:

- In **Event source**, you can put anything you want (for exmaple, `Logistics`)

- In **Detail type**, you should put either `Delivered` or `DeliveryCanceled`

- In **Event detail**, you need to put a JSON object identifying the order in the format (see the `deliveryEvent.json` file in the `data` directory):

```json
{
	"customerId": "customer-1",
    "orderId": "..."
}
```

After you **Send** the event, new events will appear.

#### Delivered order

If you send the `Delivered` event, these are the new events in the logs:

- `Delivered` (the event you sent form the EventBridge console)
- `DeliveryWasDelivered` (from the Delivery service)
- `OrderDelivered` (from the Order service)

In the `InventoryTable`, the order has status `DELIVERED`.

#### Delivery canceled

If you send the `DeliveryCanceled` event, these are the new events in the logs:

- `DeliveryCanceled` (the event you sent form the EventBridge console)
- `DeliveryWasCanceled` (from the Delivery service)
- `OrderCanceled` (from the Order service)
- `ItemReturned` (from the Inventory service)
- `PaymentCanceled` (from the Payment service)

## Payment failed

To force a failed payment, you can increase the value of the `PAYMENT_FAIL_PROBABILITY` environment variable in the configuration of the `PaymentFunction` (for example, to `0.9` or `1.0`). You can change the value directly in the Lambda console or in the SAM template (and deploy).

In case you find the `PaymentFailed` event, the next events are:
- `ItemUnreserved` (from the Inventory service)

In the `InventoryTable`, the order has status `PAYMENT_FAILED`.

# Event Store / Event Sourcing

The `EventStoreFunction` is storing all events in CloudWatch Logs and in the `EventStoreTable` in DynamoDB.

The `EventStoreTable` has a primary ket composed by:
- `who` : `C#<customerId>` – In this way, you can quickly get all info for a customer. Events not related to a customer will use a different initial letter. For example, product updated can set this to `P#<productId>`
- `timeWhat` : `timestamp#eventType`
- `eventSource` : the source of the event
- `eventDetail` : the full JSON of the event as a string