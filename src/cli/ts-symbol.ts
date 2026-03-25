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
    context: { type: "string" },
    "context-depth": { type: "string" },
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
  if (values.help) {
    process.stdout.write(getHelpText());
    return;
  }

  const command = positionals[0] ?? "lookup";
  const normalized = normalizeCommand(command);
  const mode = resolveMode(normalized, values.mode);
  const format = resolveFormat(values.format, values.json);
  const root = values.root ?? process.cwd();
  const context = values.context ? Number(values.context) : 0;
  const contextDepth = resolveContextDepth(values["context-depth"]);

  if (Number.isNaN(context) || context < 0) {
    throw new CliError("error: --context must be a non-negative number");
  }

  const result = await lookupSymbol({
    symbol: values.symbol ?? "",
    mode,
    root,
    context,
    contextDepth,
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
    `error: unknown command '${value}'. Use lookup, definition, or usage.`,
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

function resolveContextDepth(value: string | undefined): ContextDepth {
  if (!value || value === "basic") return "basic";
  if (value === "structural") return "structural";
  throw new CliError("error: --context-depth must be 'basic' or 'structural'");
}

function getHelpText(): string {
  return `ts-symbol

Usage:
  ts-symbol lookup --symbol <name> --mode <definition|usage> --root <path> [--json|--format pretty] [--context N] [--context-depth basic|structural]
  ts-symbol definition --symbol <name> --root <path> [--json|--format pretty] [--context N] [--context-depth basic|structural]
  ts-symbol usage --symbol <name> --root <path> [--json|--format pretty] [--context N] [--context-depth basic|structural]

Notes:
  --json is the default output mode.
  --root defaults to the current working directory.
  --context controls surrounding snippet lines.
  --context-depth structural adds usageKind and enclosingSymbol to JSON matches.
  --config is available for advanced/custom rule development.
`;
}
