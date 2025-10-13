/* call with await */
async function g() {
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  await foo(5);
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
  // comment line
}

/* call with await */
async function h() {
  return async function bar() {
    await foo();
  };
}
