// Function declaration
function MySymbol() {
  return 42;
}

// Arrow function assigned to variable
const MySymbolArrow = () => {
  return "hello";
};

// Variable declarations
const MySymbolConst = 123;
let MySymbolLet = "variable";
var MySymbolVar = { key: "value" };

// Class declaration
class MySymbolClass {
  constructor(public value: number) {}
  
  method() {
    return this.value;
  }
}

// Interface declaration
interface MySymbolInterface {
  prop: string;
  method(): number;
}

// Type alias declaration
type MySymbolType = {
  id: number;
  name: string;
};

// Enum declaration
enum MySymbolEnum {
  First,
  Second,
  Third
}

// Namespace declaration
namespace MySymbolNamespace {
  export const value = "namespace";
}

// Import statements
import { MySymbolImport } from "./module";
import MySymbolDefault from "./default";
import * as MySymbolNamespaceImport from "./namespace-module";

// Export statements
export function MySymbolExport() {
  return "exported";
}

export class MySymbolExportClass {
  field: string;
}

export interface MySymbolExportInterface {
  exportedProp: boolean;
}

export type MySymbolExportType = string | number;

export enum MySymbolExportEnum {
  A,
  B
}

export const MySymbolExportConst = "exported const";

// Export specifier
const localSymbol = "local";
export { localSymbol as MySymbolExportAlias };

// Export default
export default MySymbolDefaultExport;

function MySymbolDefaultExport() {
  return "default export";
}

// Method definition in class
class MyClassWithMethod {
  MySymbolMethod() {
    return "method";
  }
}

// Property definition
class MyClassWithProperty {
  MySymbolProperty: string = "property";
}

// Type parameter
function MySymbolGeneric<T extends MySymbolConstraint>(param: T) {
  return param;
}

interface MySymbolConstraint {
  id: number;
}

// Parameter
function MySymbolFunctionWithParam(MySymbolParam: string) {
  return MySymbolParam;
}