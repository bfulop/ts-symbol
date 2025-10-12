/* Top-level call */
foo('top-level');

/* Function declaration */
export function outer() {
  foo('in-function');

  function inner() {
    foo('in-nested-function');
  }

  return inner;
}

/* Arrow function assigned to const */
const arrow = () => {
  const nestedArrow = () => foo('nested-arrow');
  return foo('arrow-body');
};

/* Function expression */
const expr = function namedExpr() {
  foo('in-function-expr');
};

/* Class with methods */
class Example {
  method() {
    foo('in-method');
  }

  nested() {
    return () => foo('arrow-in-method');
  }

  async run() {
    await foo('await-in-method');
  }
}

new Example().method();
