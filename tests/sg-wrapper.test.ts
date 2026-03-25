import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

const LEGACY_CLI_ENTRY = join(process.cwd(), "src", "cli", "sg-wrapper.ts");
const PUBLIC_CLI_ENTRY = join(process.cwd(), "src", "cli", "ts-symbol.ts");
const CONFIG_PATH = join(process.cwd(), "ast-grep-playground", "sgconfig.yml");

async function runBun(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string | undefined> },
) {
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd: options?.cwd,
    env: options?.env,
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

function runLegacyCli(args: string[]) {
  return runBun(["run", LEGACY_CLI_ENTRY, ...args]);
}

function runPublicCli(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string | undefined> },
) {
  return runBun([PUBLIC_CLI_ENTRY, ...args], options);
}

function runScriptCli(args: string[]) {
  return runBun(["run", "ts-symbol", ...args]);
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

function stripHeader(block: string) {
  const lines = block.split("\n");
  return lines.slice(1).join("\n");
}

test("legacy wrapper requires --symbol", async () => {
  const { exitCode, stderr } = await runLegacyCli([
    "test-fixtures/definitions.ts",
    "--config",
    CONFIG_PATH,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("error: --symbol is required");
});

test("legacy wrapper emits definition blocks", async () => {
  const { exitCode, stdout, stderr } = await runLegacyCli([
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
  expect(blocks[0].startsWith("// path: definitions.ts:")).toBe(true);
  expect(blocks.some((block) => block.includes("function MySymbol()"))).toBe(true);
});

test("legacy wrapper context flag adds surrounding lines", async () => {
  const { stdout: noContext } = await runLegacyCli([
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
  const { stdout: withContext } = await runLegacyCli([
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
  expect(stripHeader(withoutBlocks[0]!)).not.toContain("// Function declaration");
  expect(stripHeader(withBlocks[0]!)).toContain("// Function declaration");
});

test("public CLI returns JSON by default", async () => {
  const root = resolve("test-fixtures/definitions.ts");
  const { exitCode, stdout, stderr } = await runPublicCli([
    "definition",
    "--symbol",
    "MySymbol",
    "--root",
    root,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const payload = JSON.parse(stdout);
  expect(payload.symbol).toBe("MySymbol");
  expect(payload.mode).toBe("definition");
  expect(payload.root).toBe(root);
  expect(payload.matches.length).toBeGreaterThan(0);
  expect(payload.matches[0].file).toBe("definitions.ts");
  expect(payload.matches[0].snippet).toContain("MySymbol");
  expect(payload.matches[0].ruleId).toContain("ts-symbol-definition");
});

test("public CLI lookup command requires mode", async () => {
  const { exitCode, stderr } = await runPublicCli([
    "lookup",
    "--symbol",
    "MySymbol",
    "--root",
    resolve("test-fixtures/definitions.ts"),
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("--mode is required");
});

test("public CLI returns pretty output when requested", async () => {
  const { exitCode, stdout, stderr } = await runPublicCli([
    "usage",
    "--symbol",
    "MySymbol",
    "--root",
    resolve("test-fixtures/usages.ts"),
    "--format",
    "pretty",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("```ts");
  expect(stdout).toContain("// path: usages.ts:");
});

test("public CLI returns zero matches successfully", async () => {
  const { exitCode, stdout, stderr } = await runPublicCli([
    "usage",
    "--symbol",
    "DefinitelyMissingSymbol",
    "--root",
    resolve("test-fixtures/usages.ts"),
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const payload = JSON.parse(stdout);
  expect(payload.matches).toEqual([]);
});

test("public CLI adds structural context for usage matches when requested", async () => {
  const { exitCode, stdout, stderr } = await runPublicCli([
    "usage",
    "--symbol",
    "MySymbol",
    "--root",
    resolve("test-fixtures/usages.ts"),
    "--context-depth",
    "structural",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const payload = JSON.parse(stdout);
  const typedMatch = payload.matches.find((match: any) =>
    match.snippet.includes('typed: MySymbol = value'),
  );
  expect(typedMatch?.usageKind).toBe("type_reference");
  expect(typedMatch?.enclosingSymbol).toEqual({
    name: "typed",
    kind: "const",
    startLine: 43,
    endLine: 43,
  });

  const callMatch = payload.matches.find((match: any) =>
    match.snippet.includes("instance = new MySymbol()"),
  );
  expect(callMatch?.usageKind).toBe("call");
  expect(callMatch?.enclosingSymbol?.name).toBe("instance");
});

test("public CLI adds structural context for definition matches when requested", async () => {
  const { exitCode, stdout, stderr } = await runPublicCli([
    "definition",
    "--symbol",
    "MySymbol",
    "--root",
    resolve("test-fixtures/definitions.ts"),
    "--context-depth",
    "structural",
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const payload = JSON.parse(stdout);
  expect(payload.matches).toHaveLength(1);
  expect(payload.matches[0].usageKind).toBe("definition");
  expect(payload.matches[0].enclosingSymbol).toEqual({
    name: "MySymbol",
    kind: "function",
    startLine: 2,
    endLine: 4,
  });
});

test("public CLI resolves bundled config outside repo root", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "ts-symbol-cwd-"));
  const { exitCode, stdout, stderr } = await runPublicCli(
    [
      "definition",
      "--symbol",
      "MySymbol",
      "--root",
      resolve("test-fixtures/definitions.ts"),
    ],
    { cwd: tmpDir },
  );

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const payload = JSON.parse(stdout);
  expect(payload.matches.length).toBeGreaterThan(0);
});

test("public CLI reports missing sg with dedicated exit code", async () => {
  const { exitCode, stderr } = await runPublicCli(
    [
      "definition",
      "--symbol",
      "MySymbol",
      "--root",
      resolve("test-fixtures/definitions.ts"),
    ],
    {
      env: {
        ...process.env,
        PATH: join(tmpdir(), "ts-symbol-missing-path"),
      },
    },
  );

  expect(exitCode).toBe(2);
  expect(stderr).toContain("ast-grep (sg) binary not found");
});

test("tsx lookups work through the public CLI", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sg-wrapper-tsx-"));
  const filePath = join(tmpDir, "SampleComponent.tsx");

  await writeFile(
    filePath,
    [
      "import { getOperatorLabel } from './helpers';",
      "",
      "type Props = { operator: string };",
      "",
      "export const SampleComponent = ({ operator }: Props) => (",
      "  <section>",
      "    <span>{getOperatorLabel(operator)}</span>",
      "  </section>",
      ");",
    ].join("\n"),
  );

  const usage = await runPublicCli([
    "usage",
    "--symbol",
    "getOperatorLabel",
    "--root",
    filePath,
  ]);

  expect(usage.stderr).toBe("");
  expect(usage.exitCode).toBe(0);
  const usagePayload = JSON.parse(usage.stdout);
  expect(usagePayload.matches.length).toBe(1);
  expect(usagePayload.matches[0].file).toBe("SampleComponent.tsx");
  expect(usagePayload.matches[0].snippet).toContain("getOperatorLabel(operator)");

  const definition = await runPublicCli([
    "definition",
    "--symbol",
    "SampleComponent",
    "--root",
    filePath,
  ]);

  expect(definition.stderr).toBe("");
  expect(definition.exitCode).toBe(0);
  const definitionPayload = JSON.parse(definition.stdout);
  expect(definitionPayload.matches.length).toBe(1);
  expect(definitionPayload.matches[0].snippet).toContain("SampleComponent =");
});

test("script entrypoint supports installed-style usage", async () => {
  const { exitCode, stdout, stderr } = await runScriptCli([
    "definition",
    "--symbol",
    "MySymbol",
    "--root",
    resolve("test-fixtures/definitions.ts"),
  ]);

  expect(stderr === "" || stderr.startsWith("$ bun run")).toBe(true);
  expect(exitCode).toBe(0);
  const payload = JSON.parse(stdout);
  expect(payload.matches.length).toBeGreaterThan(0);
});

test("OpenCode adapter returns the same semantic result shape", async () => {
  const { findUsage } = await import("../ts-symbol");
  const output = await findUsage.execute({
    symbol: "MySymbol",
    root: resolve("test-fixtures/usages.ts"),
  });

  expect(typeof output).toBe("string");
  expect(output).toContain("// path: usages.ts:");
  expect(output).toContain("MySymbol");
});
