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
    "--json",
    "stream",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = parseJsonLines(stdout);
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
    "--json",
    "stream",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const matches = parseJsonLines(stdout);
  const ruleIds = matches.map((match) => match.ruleId);
  expect(ruleIds.some((id) => id.includes("baz"))).toBe(true);
});
