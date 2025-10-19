// Test cases for expanded context matching
// These should match the entire statement or function body

// Variable declarations with function calls
const filtersWithOptions = group.filters.map((filter) => ({
  label: getOperatorLabel(operator),
  value: operator,
}));

// Arrow function with symbol usage
const processItems = (items: Item[]) => {
  return items.map(item => getOperatorLabel(item.type));
};

// Function declaration with symbol usage
function buildViewModel(params: BuildParams) {
  const { t, group, instances } = params;
  
  const filtersWithOptions = group.filters.map((filter) => {
    const operatorOptions = filter.operators.map((operator) => ({
      label: getOperatorLabel(operator),
      value: operator,
    }));
    return operatorOptions;
  });
  
  return { filtersWithOptions };
}

// Return statement with symbol usage
function getLabels(operators: Operator[]) {
  return operators.map(op => ({
    label: getOperatorLabel(op),
    value: op
  }));
}

// Expression statement with symbol usage
getOperatorLabel(operator);

// Assignment expression
const result = getOperatorLabel(operator);

// Object property with symbol usage
const config = {
  label: getOperatorLabel(operator),
  value: operator
};

// Array with symbol usage
const labels = [
  getOperatorLabel(op1),
  getOperatorLabel(op2),
  getOperatorLabel(op3)
];

// Conditional expression with symbol usage
const displayLabel = condition ? getOperatorLabel(operator) : 'Unknown';

// Template literal with symbol usage
const message = `Operator: ${getOperatorLabel(operator)}`;

// Method call on result of symbol usage
const processed = getOperatorLabel(operator).toUpperCase();

// Nested function calls
const nested = process(getOperatorLabel(operator));

// Type annotation with symbol usage
const typedLabel: string = getOperatorLabel(operator);

// Complex expression with multiple symbol usages
const complex = items
  .filter(item => item.active)
  .map(item => getOperatorLabel(item.operator))
  .join(', ');