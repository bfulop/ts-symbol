// Import-only references for MySymbol
import { MySymbol } from "./module";
import type { MySymbol as MySymbolType } from "./type-module";
import MySymbolDefault from "./default-module";
import * as MySymbolNamespace from "./namespace";

type UsingType = MySymbolType;

export const usingImports = () => {
  return [MySymbol, MySymbolDefault, MySymbolNamespace];
};

export type ImportedTypeAlias = UsingType;
