import { tool } from "@opencode-ai/plugin";
import { homedir } from "os";
import { resolve, join } from "path";

const WRAPPER = "/Users/balint.fulop/Work2/astGrep/src/cli/sg-wrapper.ts";
const SGCONFIG =
  "/Users/balint.fulop/Work2/astGrep/ast-grep-playground/sgconfig.yml";
const DEFAULT_ROOT = "~/Work/pulsar";

type Mode = "definition" | "usage" | "usage-expanded";

function expandTilde(p: string) {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

async function runScan(mode: Mode, symbol: string, root?: string) {
  const rootPath = resolve(expandTilde(root ?? DEFAULT_ROOT));

  const proc = Bun.spawn(
    [
      "bun",
      "run",
      WRAPPER,
      rootPath,
      "--symbol",
      symbol,
      "--mode",
      mode,
      "--context",
      "0",
      "--config",
      SGCONFIG,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout?.text() ?? Promise.resolve(""),
    proc.stderr?.text() ?? Promise.resolve(""),
  ]);

  if (exitCode !== 0) {
    throw new Error((stderr || "sg-wrapper failed").trim());
  }

  const out = stdout.trim();
  if (!out) throw new Error("Empty output from sg-wrapper");
  return out;
}

export const findDefinition = tool({
  description: "Find TypeScript symbol definitions in the repository",
  args: {
    symbol: tool.schema
      .string()
      .min(1)
      .describe("Symbol identifier to search for"),
    root: tool.schema
      .string()
      .optional()
      .describe("Repository root (defaults to ~/Work/pulsar)"),
  },
  async execute(args: { symbol: string; root?: string }) {
    return runScan("definition", args.symbol, args.root);
  },
});

export const findUsage = tool({
  description: "Find TypeScript symbol usages in the repository",
  args: {
    symbol: tool.schema
      .string()
      .min(1)
      .describe("Symbol identifier to search for"),
    root: tool.schema
      .string()
      .optional()
      .describe("Repository root (defaults to ~/Work/pulsar)"),
  },
  async execute(args: { symbol: string; root?: string }) {
    return runScan("usage-expanded", args.symbol, args.root);
  },
});
