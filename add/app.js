exports.lambdaHandler = async (event, context) => {
    var numbers = event.add.numbers;

    var total = numbers.reduce(
        function(previousValue, currentValue, index, array) {
        return previousValue + currentValue; });

    return { result: total };
};
