// Function calls - direct identifier
MySymbol();
MySymbol("arg1", "arg2");

// Function calls - member expression
obj.MySymbol();
this.MySymbol();

// Member access - property identifier
const value = obj.MySymbol;
const prop = this.MySymbol;

// Variable references in expressions
const result = MySymbol + 5;
const combined = MySymbol + "string";

// Variable references in statements
MySymbol;
return MySymbol;
const assigned = MySymbol = 10;

// Binary expressions
const sum = MySymbol + otherVar;
const isEqual = MySymbol === target;

// Unary expressions
const notMySymbol = !MySymbol;
const count = ++MySymbol;

// Update expressions
MySymbol++;
MySymbol--;

// New expressions
const instance = new MySymbol();
const created = new MySymbol(param1, param2);

// Await expressions
const awaited = await MySymbol;
const result2 = await MySymbol();

// Type annotations
const typed: MySymbol = value;
let annotated: MySymbol = "typed";

function paramType(param: MySymbol): MySymbol {
  return param;
}

// Generic type arguments
const generic = container<MySymbol>();
const mapped = items.map<MySymbol>(transform);

// Extends clauses
class ExtendedClass extends MySymbol {
  constructor() {
    super();
  }
}

interface ExtendedInterface extends MySymbol {
  additionalProp: string;
}

// Implements clauses
class Implementation implements MySymbol {
  prop: string = "impl";
}

// Type assertions (as)
const asserted = someValue as MySymbol;
const cast = unknown as MySymbol;

// Type assertions (satisfies)
const satisfied = someValue satisfies MySymbol;

// Export references
export { MySymbol as ExportedSymbol };

// Destructuring patterns
const { MySymbol } = obj;
const { MySymbol: renamed } = obj;
const [MySymbol] = array;

// JSX (for tsx files)
const jsxElement = <MySymbol prop="value" />;
const jsxWithChildren = <MySymbol>Children content</MySymbol>;

// JSX member expressions
const jsxMember = <Container.MySymbol prop="value" />;

// Template literal expressions
const template = `Value: ${MySymbol}`;
const interpolated = `${MySymbol} and ${other}`;

// Conditional expressions
const conditional = condition ? MySymbol : defaultValue;
const ternary = test ? MySymbol : alternative;

// Object property access
const objLiteral = {
  key: MySymbol,
  value: MySymbol
};

// Array elements
const arrayWithSymbol = [MySymbol, otherValue];
const arrayAccess = [MySymbol][0];

// Function arguments
function callWithSymbol() {
  return process(MySymbol);
}

// Method calls on symbol
MySymbol.method();
MySymbol.property = "value";

// Chained calls
const chained = MySymbol().method().property;

// Import usage (referencing imported symbols)
import { MySymbolImport } from "./module";
MySymbolImport();

// Default import usage
import MySymbolDefault from "./default";
MySymbolDefault();

// Namespace import usage
import * as MySymbolNamespaceImport from "./namespace-module";
MySymbolNamespaceImport.value;