/**
 * Semantic TypeScript symbol lookup.
 * Returns one or more blocks. Each block starts with:
 *   <path>:<startLine>-<endLine>
 * Followed by the exact code for that range.
 * Callers MUST print the tool response exactly, without truncation or reformatting.
 * Do not wrap in markdown fences. Do not summarize inside the block.
 */
import { homedir } from "os";
import { join, resolve } from "path";
import {
  formatPrettyResult,
  lookupSymbol,
  type SymbolLookupMode,
} from "./src/lib/ts-symbol-scan";

const DEFAULT_ROOT = "~/Work/pulsar";

type LookupArgs = { symbol: string; root?: string };
type ToolFactory = {
  schema: {
    string(): {
      min(value: number): any;
      optional(): any;
      describe(text: string): any;
    };
  };
  <T>(definition: T): T;
};

function expandTilde(value: string) {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

async function runScan(mode: SymbolLookupMode, symbol: string, root?: string) {
  const rootPath = resolve(expandTilde(root ?? DEFAULT_ROOT));
  const result = await lookupSymbol({
    symbol,
    mode,
    root: rootPath,
    context: 0,
  });

  return formatPrettyResult(result).trim();
}

const opencode = await import("@opencode-ai/plugin").catch(() => null);
const toolFactory = (opencode?.tool ?? null) as ToolFactory | null;

function createLookupTool(mode: SymbolLookupMode, description: string) {
  if (!toolFactory) {
    return {
      description,
      args: {
        symbol: { type: "string", required: true },
        root: { type: "string", required: false },
      },
      async execute(args: LookupArgs) {
        return runScan(mode, args.symbol, args.root);
      },
    };
  }

  return toolFactory({
    description,
    args: {
      symbol: toolFactory.schema
        .string()
        .min(1)
        .describe("Symbol identifier to search for"),
      root: toolFactory.schema
        .string()
        .optional()
        .describe("Repository root (defaults to ~/Work/pulsar)"),
    },
    async execute(args: LookupArgs) {
      return runScan(mode, args.symbol, args.root);
    },
  });
}

export const findDefinition = createLookupTool(
  "definition",
  "Find TypeScript symbol definitions in the repository",
);

export const findUsage = createLookupTool(
  "usage",
  "Find TypeScript symbol usages in the repository. Each block starts with: <path>:<startLine>-<endLine>",
);
