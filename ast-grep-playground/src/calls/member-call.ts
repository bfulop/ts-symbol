/* member calls and a free call */
const obj = { foo: (..._args: unknown[]) => 123 }
obj.foo('a', 'b')
foo('free')
