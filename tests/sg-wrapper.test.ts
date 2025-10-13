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

// Note: native passthrough mode intentionally not tested here because scan output
// requires diagnostic messages/severity in rules to produce text. Our rules are matchers only.
