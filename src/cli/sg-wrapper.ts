import { parseArgs } from "node:util";
import {
  CliError,
  formatPrettyResult,
  lookupSymbol,
  type SymbolLookupMode,
} from "../lib/ts-symbol-scan";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    symbol: { type: "string" },
    mode: { type: "string" },
    config: { type: "string" },
    context: { type: "string" },
    funcName: { type: "string" },
    typeName: { type: "string" },
    json: { type: "string" },
    unique: { type: "boolean" },
    pretty: { type: "boolean" },
    unified: { type: "string" },
    format: { type: "string" },
    native: { type: "boolean" },
  },
  strict: true,
  allowPositionals: true,
});

void run().catch((error) => {
  if (error instanceof CliError) {
    if (error.message) console.error(error.message);
    process.exitCode = error.exitCode;
    return;
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function run(): Promise<void> {
  if (positionals.length === 0) {
    throw new CliError("error: provide at least one path to scan");
  }

  const mode = values.mode as string | undefined;
  if (mode && mode !== "definition" && mode !== "usage") {
    throw new CliError("error: --mode must be 'definition' or 'usage'");
  }

  const context = values.context ? Number(values.context) : 0;
  if (Number.isNaN(context) || context < 0) {
    throw new CliError("error: --context must be a non-negative number");
  }

  const result = await lookupSymbol({
    symbol: values.symbol ?? "",
    mode: (mode ?? "definition") as SymbolLookupMode,
    root: positionals[0],
    context,
    configPath: values.config,
  });

  const pretty = formatPrettyResult(result);
  if (pretty) process.stdout.write(`${pretty}\n`);
}
