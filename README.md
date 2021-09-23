# Events and Workflows

Start by building and deploying the projext:

```bash
sam build -p # Parallel build

sam deploy -g # Guided deployment, 
```

Next times, when you update the code, you can build and deploy with:

```bash
sam build -c -p && sam deploy # Caching previous builds
```

# Services

Customer - customer information such as name, address, and email
Order - to create an order orchestrating all other services, and describe the order status
Inventory - to store inventory information of items to sell
Payment - to make and cancel payments, it can randomly fail (see Demo below)
Delivery - to estimate distance and cost of a delivery, and to start, complete, or cancel a delivery

# Operations

On the Amazon API Gateway REST API endpoint (starting a workflow):

GET /order/create/{customerId}/{orderId}

On the Amazon API Gateway HTTP API endpoint:

GET /customer/describe/{customerId}
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

# Demo

Load the sample data in the `data` directory, use the same stack name you entered for `sam deploy`:

```bash
./load.sh <stack-name>
```

To create an order from the AWS Step Functions console, use this input to start the execution of the state machine:

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
curl -i https://sam9cycaik.execute-api.eu-west-1.amazonaws.com/delivery/delivered/customer-1/2021-09-23T13:15:06.510Z
```

To cancel the delivery, replace `delivered` with `cancel`.

```bash
curl -i <DeliveryApi>/cancel/<customerId>/<orderId>
```

For example:

```bash
curl -i https://sam9cycaik.execute-api.eu-west-1.amazonaws.com/delivery/cancel/customer-1/2021-09-23T13:15:06.510Z
```
