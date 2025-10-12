/* call with await */
async function g() {
  await foo(5);
}

/* call with await */
async function h() {
  return async function bar() {
    await foo();
  };
}
