import { parseArgs } from "node:util";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { YAML } from "bun";

type Config = {
  ruleDirs?: string[];
  utilDirs?: string[];
  [key: string]: unknown;
};

type Replacements = Record<string, string>;

// Minimal CLI: accept only what we need, but tolerate some legacy flags
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    symbol: { type: "string" },
    mode: { type: "string" },
    config: { type: "string" },
    context: { type: "string" },
    // Tolerate legacy flags passed by older callers (ignored)
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

if (positionals.length === 0) {
  console.error("error: provide at least one path to scan");
  process.exitCode = 1;
  process.exit();
}

// Validate mode parameter
const mode = values.mode as string | undefined;
if (mode && mode !== "definition" && mode !== "usage") {
  console.error("error: --mode must be 'definition' or 'usage'");
  process.exitCode = 1;
  process.exit();
}

// Symbol is required for symbol search
if (!values.symbol) {
  console.error("error: --symbol is required");
  process.exitCode = 1;
  process.exit();
}

const symbol = values.symbol;
const searchMode = (mode ?? "definition") as "definition" | "usage";
const contextLines = values.context ? Math.max(0, Number(values.context)) : 0; // default to exact node

const replacements: Replacements = { __SYMBOL__: symbol };

const configPath = resolve(
  values.config ?? join(process.cwd(), "ast-grep-playground", "sgconfig.yml"),
);

async function loadConfig(
  path: string,
): Promise<{ config: Config; dir: string }> {
  const raw = await readFile(path, "utf8");
  const config = YAML.parse(raw) as Config;
  if (!config || typeof config !== "object") {
    throw new Error(`invalid config at ${path}`);
  }
  return { config, dir: dirname(path) };
}

async function copyWithSubstitution(
  src: string,
  dest: string,
  map: Replacements,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyWithSubstitution(srcPath, destPath, map);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
        const content = await readFile(srcPath, "utf8");
        const replaced = applyReplacements(content, map);
        await writeFile(destPath, replaced);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }
}

function applyReplacements(input: string, map: Replacements): string {
  let result = input;
  for (const [token, value] of Object.entries(map)) {
    result = result.split(token).join(value);
  }
  return result;
}

async function prepareRuleDirectories(
  config: Config,
  configDir: string,
  tempDir: string,
  map: Replacements,
): Promise<{ ruleDirs: string[]; utilDirs: string[] }> {
  const ruleRoot = join(tempDir, "rules");
  const utilRoot = join(tempDir, "utils");
  const nextRuleDirs: string[] = [];
  const nextUtilDirs: string[] = [];

  const ruleDirs = Array.isArray(config.ruleDirs) ? config.ruleDirs : [];
  for (const [index, dir] of ruleDirs.entries()) {
    const abs = resolve(configDir, dir);
    const dest = join(ruleRoot, `${index}-${basename(dir)}`);
    await copyWithSubstitution(abs, dest, map);
    nextRuleDirs.push(relative(tempDir, dest));
  }

  const utilDirs = Array.isArray(config.utilDirs) ? config.utilDirs : [];
  for (const [index, dir] of utilDirs.entries()) {
    const abs = resolve(configDir, dir);
    const dest = join(utilRoot, `${index}-${basename(dir)}`);
    await copyWithSubstitution(abs, dest, map);
    nextUtilDirs.push(relative(tempDir, dest));
  }

  return { ruleDirs: nextRuleDirs, utilDirs: nextUtilDirs };
}

async function run(): Promise<void> {
  const { config, dir } = await loadConfig(configPath);
  const workDir = await mkdtemp(join(tmpdir(), "sg-wrapper-"));

  try {
    const { ruleDirs, utilDirs } = await prepareRuleDirectories(
      config,
      dir,
      workDir,
      replacements,
    );
    const generatedConfig: Config = {
      ...config,
      ruleDirs,
    };
    if (utilDirs.length > 0) {
      generatedConfig.utilDirs = utilDirs;
    } else {
      delete generatedConfig.utilDirs;
    }

    const generatedConfigPath = join(workDir, "sgconfig.yml");
    await writeFile(generatedConfigPath, YAML.stringify(generatedConfig));

    // Filter by ruleId based on requested mode
    const rulePattern =
      searchMode === "definition"
        ? "^ts-symbol-definition(-tsx)?$"
        : "^ts-symbol-usage(-tsx)?$";

    const sgArgs = [
      "scan",
      "--config",
      generatedConfigPath,
      `--json=stream`,
      "--include-metadata",
      "--filter",
      rulePattern,
      ...positionals.map((path) => resolve(path)),
    ];

    // Check if sg binary exists
    try {
      await Bun.spawn(["sg", "--version"], { stdout: "ignore", stderr: "ignore" }).exited;
    } catch {
      console.error("error: ast-grep (sg) binary not found. Please install ast-grep first.");
      process.exitCode = 1;
      return;
    }

    const proc = Bun.spawn(["sg", ...sgArgs], { stdout: "pipe", stderr: "pipe" });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      proc.stdout?.text() ?? Promise.resolve(""),
      proc.stderr?.text() ?? Promise.resolve("")
    ]);

    if (stderr) process.stderr.write(stderr);

    if (exitCode !== 0) {
      process.exitCode = exitCode;
      return;
    }

    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed: MatchObj[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // ignore unparsable lines
      }
    }

    const blocks = await toCodeBlocks(parsed, contextLines);
    for (const block of blocks) {
      process.stdout.write("```ts\n");
      process.stdout.write(block + "\n");
      process.stdout.write("```\n\n");
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

type Location = {
  file: string;
  start: { line?: number; column?: number; byte?: number };
  end: { line?: number; column?: number; byte?: number };
};

type MatchObj = Record<string, any> & {
  ruleId?: string;
  file?: string;
  range?: { start: any; end: any };
  span?: { start: any; end: any };
  position?: { start: any; end: any };
};
async function toCodeBlocks(objs: MatchObj[], ctx: number): Promise<string[]> {
  const blocks: string[] = [];
  const fileCache = new Map<string, string[]>();
  for (const it of objs) {
    const loc = extractLocation(it);
    if (!loc || !loc.file) continue;
    let lines = fileCache.get(loc.file);
    if (!lines) {
      try {
        const content = await readFile(loc.file, "utf8");
        lines = content.split(/\r?\n/);
        fileCache.set(loc.file, lines);
      } catch {
        continue;
      }
    }
    const sLine = normalizeLine(loc.start.line);
    const eLine = normalizeLine(loc.end.line);
    const start = Math.max(1, Math.min(sLine, eLine) - ctx);
    const end = Math.min(lines.length, Math.max(sLine, eLine) + ctx);
    let snippet: string | undefined;

    if (ctx === 0 && typeof it.text === "string" && it.text.length > 0) {
      snippet = it.text;
    } else {
      snippet = lines.slice(start - 1, end).join("\n");
    }

    if (!snippet) continue;

    const relPath = relative(process.cwd(), loc.file);
    const header = `// path: ${relPath}:${start}-${end}`;
    blocks.push(`${header}\n${snippet}`.trimEnd());
  }
  return blocks;
}

function extractLocation(obj: MatchObj): Location | null {
  const file =
    (obj.file as string) || (obj.path as string) || (obj.filePath as string);
  const r = (obj.range as any) || (obj.span as any) || (obj.position as any);
  if (!file || !r) return null;
  const start = r.start || {};
  const end = r.end || {};
  return { file, start, end };
}

function normalizeLine(n: any): number {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "") return Number(n);
  return 1;
}
