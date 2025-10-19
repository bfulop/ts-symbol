import { test, expect } from "bun:test";
import { join } from "path";

const CLI_ENTRY = join(process.cwd(), "src", "cli", "sg-wrapper.ts");
const CONFIG_PATH = join(process.cwd(), "ast-grep-playground", "sgconfig.yml");

async function runCli(args: string[]) {
  const proc = Bun.spawn([
    "bun",
    "run",
    CLI_ENTRY,
    ...args,
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout?.text() ?? Promise.resolve(""),
    proc.stderr?.text() ?? Promise.resolve(""),
  ]);

  return { exitCode, stdout, stderr };
}

function extractCodeBlocks(output: string) {
  const blocks: string[] = [];
  const regex = /```ts\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

test("requires --symbol", async () => {
  const { exitCode, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--config",
    CONFIG_PATH,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("error: --symbol is required");
});

test("definition mode emits definition blocks", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "definition",
    "--config",
    CONFIG_PATH,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const blocks = extractCodeBlocks(stdout);
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks.some((b) => b.includes("function MySymbol()"))).toBe(true);
});

test("usage mode emits contextual blocks", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/usages.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "usage",
    "--config",
    CONFIG_PATH,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const blocks = extractCodeBlocks(stdout);
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks.some((b) => /function\s+.*\bMySymbol\b/.test(b))).toBe(true);
});

test("context flag adds surrounding lines", async () => {
  const { stdout: noContext } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "definition",
    "--config",
    CONFIG_PATH,
    "--context",
    "0",
  ]);
  const { stdout: withContext } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "definition",
    "--config",
    CONFIG_PATH,
    "--context",
    "1",
  ]);

  const withoutBlocks = extractCodeBlocks(noContext);
  const withBlocks = extractCodeBlocks(withContext);
  expect(withoutBlocks[0]).not.toContain("// Function declaration");
  expect(withBlocks[0]).toContain("// Function declaration");
});

test("invalid mode parameter shows error", async () => {
  const { exitCode, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "invalid",
    "--config",
    CONFIG_PATH,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("--mode must be 'definition' or 'usage'");
});

test("defaults to definition mode", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--config",
    CONFIG_PATH,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const blocks = extractCodeBlocks(stdout);
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks.some((b) => b.includes("function MySymbol()"))).toBe(true);
});
