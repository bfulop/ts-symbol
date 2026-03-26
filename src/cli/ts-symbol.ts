#!/usr/bin/env bun

import { parseArgs } from "node:util";
import {
  CliError,
  type ContextDepth,
  formatPrettyResult,
  lookupSymbol,
  type OutputFormat,
  type SymbolLookupMode,
} from "../lib/ts-symbol-scan";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    symbol: { type: "string" },
    mode: { type: "string" },
    root: { type: "string" },
    context: { type: "boolean" },
    "snippet-context": { type: "string" },
    "context-depth": { type: "string" },
    "with-context-symbols": { type: "boolean" },
    config: { type: "string" },
    format: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
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
  const command = positionals[0] ?? "lookup";
  if (values.help || command === "help") {
    process.stdout.write(getHelpText());
    return;
  }

  const normalized = normalizeCommand(command);
  const mode = resolveMode(normalized, values.mode);
  const format = resolveFormat(values.format, values.json);
  const root = values.root ?? process.cwd();
  const context = values["snippet-context"]
    ? Number(values["snippet-context"])
    : 0;
  const contextDepth = resolveContextDepth(
    values.context,
    values["context-depth"],
    values["with-context-symbols"],
  );

  if (Number.isNaN(context) || context < 0) {
    throw new CliError("error: --context must be a non-negative number");
  }

  const result = await lookupSymbol({
    symbol: values.symbol ?? "",
    mode,
    root,
    context,
    contextDepth,
    withContextSymbols: values["with-context-symbols"] ?? false,
    configPath: values.config,
  });

  if (format === "pretty") {
    const pretty = formatPrettyResult(result);
    if (pretty) process.stdout.write(`${pretty}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function normalizeCommand(value: string): "lookup" | SymbolLookupMode {
  if (value === "lookup" || value === "definition" || value === "usage") {
    return value;
  }

  throw new CliError(
    `error: unknown command '${value}'. Use help, lookup, definition, or usage.`,
  );
}

function resolveMode(
  command: "lookup" | SymbolLookupMode,
  modeFlag: string | undefined,
): SymbolLookupMode {
  if (command === "definition" || command === "usage") {
    if (modeFlag && modeFlag !== command) {
      throw new CliError(
        `error: --mode conflicts with '${command}' command; use --mode ${command} or omit it`,
      );
    }
    return command;
  }

  if (!modeFlag) {
    throw new CliError(
      "error: --mode is required for the 'lookup' command and must be 'definition' or 'usage'",
    );
  }

  if (modeFlag !== "definition" && modeFlag !== "usage") {
    throw new CliError("error: --mode must be 'definition' or 'usage'");
  }

  return modeFlag;
}

function resolveFormat(
  formatFlag: string | undefined,
  jsonFlag: boolean | undefined,
): OutputFormat {
  if (jsonFlag) return "json";
  if (!formatFlag) return "json";
  if (formatFlag === "json" || formatFlag === "pretty") return formatFlag;
  throw new CliError("error: --format must be 'json' or 'pretty'");
}

function resolveContextDepth(
  contextFlag: boolean | undefined,
  value: string | undefined,
  withContextSymbols: boolean | undefined,
): ContextDepth {
  if (withContextSymbols) return "structural";
  if (value === "relationships") return "relationships";
  if (contextFlag) return "structural";
  if (!value || value === "basic") return "basic";
  if (value === "structural") return "structural";
  throw new CliError(
    "error: --context-depth must be 'basic', 'structural', or 'relationships'",
  );
}

function getHelpText(): string {
  return `ts-symbol

Usage:
  ts-symbol help
  ts-symbol lookup --symbol <name> --mode <definition|usage> --root <path> [--json|--format pretty] [--context] [--snippet-context N] [--context-depth basic|structural|relationships] [--with-context-symbols]
  ts-symbol definition --symbol <name> --root <path> [--json|--format pretty] [--context] [--snippet-context N] [--context-depth basic|structural|relationships] [--with-context-symbols]
  ts-symbol usage --symbol <name> --root <path> [--json|--format pretty] [--context] [--snippet-context N] [--context-depth basic|structural|relationships] [--with-context-symbols]

Notes:
  Use 'ts-symbol help' or '--help' to show this message.
  --json is the default output mode.
  --root defaults to the current working directory.
  --context enables structural match metadata.
  --snippet-context controls surrounding snippet lines.
  --context-depth structural adds usageKind and enclosingSymbol to JSON matches.
  --context-depth relationships adds bounded contextSymbols in addition to structural context.
  --with-context-symbols adds a bounded contextSymbols array and implies structural context.
  --config is available for advanced/custom rule development.
`;
}
