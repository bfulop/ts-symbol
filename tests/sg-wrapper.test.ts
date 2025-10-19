import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

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

function parseJsonLines(output: string) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("renders matches for substituted function name", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sg-wrapper-func-"));
  const filePath = join(tmpDir, `sample-${randomUUID()}.ts`);
  await writeFile(
    filePath,
    "export function sample() { return myFunc(); }\n",
  );

  const { exitCode, stdout, stderr } = await runCli([
    filePath,
    "--config",
    CONFIG_PATH,
    "--funcName",
    "myFunc",
    "--unified",
    "false",
    "--pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = JSON.parse(stdout);
  const ruleIds = matches.map((match) => match.ruleId);
  expect(ruleIds.some((id) => id.includes("foo"))).toBe(true);
});

test("renders matches for substituted type name", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sg-wrapper-type-"));
  const filePath = join(tmpDir, `sample-${randomUUID()}.ts`);
  await writeFile(
    filePath,
    "export interface Sample { value: BazReplacement; }\n",
  );

  const { exitCode, stdout, stderr } = await runCli([
    filePath,
    "--config",
    CONFIG_PATH,
    "--typeName",
    "BazReplacement",
    "--unified",
    "false",
    "--pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = JSON.parse(stdout);
  const ruleIds = matches.flatMap((m: any) => [m.ruleId, ...(m.ruleIds ?? [])].filter(Boolean));
  expect(ruleIds.some((id: string) => String(id).includes("baz"))).toBe(true);
});

test("deduplicates multiple rule hits on the same span and provides context", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sg-wrapper-await-"));
  const filePath = join(tmpDir, `await-${randomUUID()}.ts`);
  await writeFile(
    filePath,
    [
      "async function g() {",
      "  await myFunc(5);",
      "}",
      "",
      "async function h() {",
      "  return async function bar() {",
      "    await myFunc();",
      "  };",
      "}",
      "",
    ].join("\n"),
  );

  const { exitCode, stdout, stderr } = await runCli([
    filePath,
    "--config",
    CONFIG_PATH,
    "--funcName",
    "myFunc",
    // default unified=true; ensure dedup by single composite rule
    "--pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = JSON.parse(stdout);
  // two awaits -> two unique matches
  expect(matches.length).toBe(2);
  for (const m of matches) {
    expect(m.snippet).toContain("await myFunc");
    expect(m.snippetStartLine).toBeLessThanOrEqual(m.snippetEndLine);
  }
});

test("text format outputs header and fenced code blocks", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sg-wrapper-text-"));
  const filePath = join(tmpDir, `await-${randomUUID()}.ts`);
  await writeFile(
    filePath,
    [
      "async function g() {",
      "  await myFunc(5);",
      "}",
      "",
      "async function h() {",
      "  return async function bar() {",
      "    await myFunc();",
      "  };",
      "}",
      "",
    ].join("\n"),
  );

  const { exitCode, stdout, stderr } = await runCli([
    filePath,
    "--config",
    CONFIG_PATH,
    "--funcName",
    "myFunc",
    "--format",
    "text",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("path:");
  expect(stdout).toContain("```ts\n");
  // Two matches -> at least two code blocks
  const fences = (stdout.match(/```/g) || []).length;
  expect(fences).toBeGreaterThanOrEqual(4); // opening+closing per block
  expect(stdout).toContain("await myFunc");
});

// Test mode-based symbol search
test("mode definition finds symbol definitions", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "definition",
    "--unified",
    "false",
    "--pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = JSON.parse(stdout);
  expect(matches.length).toBeGreaterThan(0);
  
  // Check that all matches have the correct format
  for (const match of matches) {
    expect(match).toHaveProperty("file");
    expect(match).toHaveProperty("line");
    expect(match).toHaveProperty("column");
    expect(match).toHaveProperty("endLine");
    expect(match).toHaveProperty("endColumn");
    expect(match).toHaveProperty("text");
    expect(match).toHaveProperty("kind", "definition");
    expect(match).toHaveProperty("ruleId", "ts-symbol-definition");
    expect(match).toHaveProperty("snippet");
    expect(match).toHaveProperty("snippetStartLine");
    expect(match).toHaveProperty("snippetEndLine");
  }
});

test("mode usage finds symbol usages", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/usages.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "usage",
    "--unified",
    "false",
    "--pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = JSON.parse(stdout);
  expect(matches.length).toBeGreaterThan(0);
  
  // Check that all matches have the correct format
  for (const match of matches) {
    expect(match).toHaveProperty("file");
    expect(match).toHaveProperty("line");
    expect(match).toHaveProperty("column");
    expect(match).toHaveProperty("endLine");
    expect(match).toHaveProperty("endColumn");
    expect(match).toHaveProperty("text");
    expect(match).toHaveProperty("kind", "usage");
    expect(match).toHaveProperty("ruleId", "ts-symbol-usage");
    expect(match).toHaveProperty("snippet");
    expect(match).toHaveProperty("snippetStartLine");
    expect(match).toHaveProperty("snippetEndLine");
  }
});

test("invalid mode parameter shows error", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "invalid",
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("--mode must be 'definition', 'usage', or 'usage-expanded'");
});

test("missing symbol with mode shows error", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--mode",
    "definition",
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("--symbol is required when using --mode");
});

test("default mode is definition when not specified", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--unified",
    "false",
    "--pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = JSON.parse(stdout);
  expect(matches.length).toBeGreaterThan(0);
  
  // Should default to definition mode
  for (const match of matches) {
    expect(match.kind).toBe("definition");
    expect(match.ruleId).toBe("ts-symbol-definition");
  }
});

test("mode works with unified mode disabled", async () => {
  const { exitCode, stdout, stderr } = await runCli([
    "test-fixtures/definitions.ts",
    "--symbol",
    "MySymbol",
    "--mode",
    "definition",
    "--unified",
    "false",
    "--pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = JSON.parse(stdout);
  expect(matches.length).toBeGreaterThan(0);
  
  // Should use ts-symbol-definition rule specifically
  for (const match of matches) {
    expect(match.ruleId).toBe("ts-symbol-definition");
  }
});

test("JSON output format is correct for opencode tool", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sg-wrapper-format-"));
  const filePath = join(tmpDir, `format-${randomUUID()}.ts`);
  await writeFile(
    filePath,
    "function MySymbol() { return 42; }\nconst result = MySymbol();\n",
  );

  const { exitCode, stdout, stderr } = await runCli([
    filePath,
    "--symbol",
    "MySymbol",
    "--mode",
    "definition",
    "--unified",
    "false",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  
  const results = parseJsonLines(stdout);
  expect(results.length).toBeGreaterThan(0);
  
  for (const result of results) {
    // Verify all required fields are present and have correct types
    expect(typeof result.file).toBe("string");
    expect(typeof result.line).toBe("number");
    expect(typeof result.column).toBe("number");
    expect(typeof result.endLine).toBe("number");
    expect(typeof result.endColumn).toBe("number");
    expect(typeof result.text).toBe("string");
    expect(result.kind).toBe("definition");
    expect(result.ruleId).toBe("ts-symbol-definition");
    expect(typeof result.snippet).toBe("string");
    expect(typeof result.snippetStartLine).toBe("number");
    expect(typeof result.snippetEndLine).toBe("number");
    
    // Verify line/column relationships
    expect(result.line).toBeLessThanOrEqual(result.endLine);
    expect(result.column).toBeGreaterThan(0);
    expect(result.endColumn).toBeGreaterThan(0);
    expect(result.snippetStartLine).toBeLessThanOrEqual(result.snippetEndLine);
  }
});

// Note: native passthrough mode intentionally not tested here because scan output
// requires diagnostic messages/severity in rules to produce text. Our rules are matchers only.
