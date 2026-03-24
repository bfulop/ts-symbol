import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { YAML } from "bun";

export type SymbolLookupMode = "definition" | "usage";
export type OutputFormat = "json" | "pretty";

type Config = {
  ruleDirs?: string[];
  utilDirs?: string[];
  [key: string]: unknown;
};

type Replacements = Record<string, string>;

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
  text?: string;
};

export type SymbolLookupMatch = {
  file: string;
  absoluteFile: string;
  startLine: number;
  endLine: number;
  ruleId?: string;
  snippet: string;
};

export type SymbolLookupResult = {
  symbol: string;
  mode: SymbolLookupMode;
  root: string;
  matches: SymbolLookupMatch[];
};

export type LookupOptions = {
  symbol: string;
  mode: SymbolLookupMode;
  root: string;
  context?: number;
  configPath?: string;
};

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function resolveBundledConfigPath(): string {
  return fileURLToPath(
    new URL("../../ast-grep-playground/sgconfig.yml", import.meta.url),
  );
}

export async function lookupSymbol(
  options: LookupOptions,
): Promise<SymbolLookupResult> {
  const symbol = options.symbol.trim();
  if (!symbol) {
    throw new CliError("error: --symbol is required");
  }

  const root = resolve(options.root);
  const context = Math.max(0, options.context ?? 0);
  const configPath = resolve(options.configPath ?? resolveBundledConfigPath());
  const { config, dir } = await loadConfig(configPath);
  const workDir = await mkdtemp(join(tmpdir(), "ts-symbol-"));

  try {
    const { ruleDirs, utilDirs } = await prepareRuleDirectories(
      config,
      dir,
      workDir,
      { __SYMBOL__: symbol },
    );

    const generatedConfig: Config = { ...config, ruleDirs };
    if (utilDirs.length > 0) {
      generatedConfig.utilDirs = utilDirs;
    } else {
      delete generatedConfig.utilDirs;
    }

    const generatedConfigPath = join(workDir, "sgconfig.yml");
    await writeFile(generatedConfigPath, YAML.stringify(generatedConfig));

    await ensureSgAvailable();

    const rulePattern =
      options.mode === "definition"
        ? "^ts-symbol-definition(-tsx)?$"
        : "^ts-symbol-usage(-tsx)?$";

    const proc = Bun.spawn(
      [
        "sg",
        "scan",
        "--config",
        generatedConfigPath,
        "--json=stream",
        "--include-metadata",
        "--filter",
        rulePattern,
        root,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      proc.stdout?.text() ?? Promise.resolve(""),
      proc.stderr?.text() ?? Promise.resolve(""),
    ]);

    if (exitCode !== 0) {
      throw new CliError(stderr.trim() || "sg scan failed");
    }

    const displayRoot = await resolveDisplayRoot(root);
    const matches = await toMatches(parseStream(stdout), context, displayRoot);

    return {
      symbol,
      mode: options.mode,
      root,
      matches,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function formatPrettyResult(result: SymbolLookupResult): string {
  if (result.matches.length === 0) return "";

  return result.matches
    .map((match) => {
      const header = `// path: ${match.file}:${match.startLine}-${match.endLine}`;
      return ["```ts", `${header}\n${match.snippet}`.trimEnd(), "```"].join("\n");
    })
    .join("\n\n");
}

async function ensureSgAvailable(): Promise<void> {
  try {
    const proc = Bun.spawn(["sg", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error("sg --version failed");
    }
  } catch {
    throw new CliError(
      "error: ast-grep (sg) binary not found. Please install ast-grep first.",
      2,
    );
  }
}

async function loadConfig(
  path: string,
): Promise<{ config: Config; dir: string }> {
  const raw = await readFile(path, "utf8");
  const config = YAML.parse(raw) as Config;
  if (!config || typeof config !== "object") {
    throw new CliError(`invalid config at ${path}`);
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
        await writeFile(destPath, applyReplacements(content, map));
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

function parseStream(stdout: string): MatchObj[] {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: MatchObj[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Ignore unparsable lines from sg.
    }
  }
  return parsed;
}

async function toMatches(
  objs: MatchObj[],
  ctx: number,
  displayRoot: string,
): Promise<SymbolLookupMatch[]> {
  const matches: SymbolLookupMatch[] = [];
  const fileCache = new Map<string, string[]>();

  for (const obj of objs) {
    const loc = extractLocation(obj);
    if (!loc?.file) continue;

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

    const startLine = normalizeLine(loc.start.line);
    const endLine = normalizeLine(loc.end.line);
    const snippetStart = Math.max(1, Math.min(startLine, endLine) - ctx);
    const snippetEnd = Math.min(lines.length, Math.max(startLine, endLine) + ctx);
    const snippet =
      ctx === 0 && typeof obj.text === "string" && obj.text.length > 0
        ? obj.text
        : lines.slice(snippetStart - 1, snippetEnd).join("\n");

    if (!snippet) continue;

    matches.push({
      file: relative(displayRoot, loc.file) || basename(loc.file),
      absoluteFile: loc.file,
      startLine: snippetStart,
      endLine: snippetEnd,
      ruleId: obj.ruleId,
      snippet,
    });
  }

  return matches;
}

async function resolveDisplayRoot(root: string): Promise<string> {
  try {
    const rootStat = await stat(root);
    return rootStat.isDirectory() ? root : dirname(root);
  } catch {
    return root;
  }
}

function extractLocation(obj: MatchObj): Location | null {
  const file =
    (obj.file as string) || (obj.path as string) || (obj.filePath as string);
  const range = (obj.range as any) || (obj.span as any) || (obj.position as any);
  if (!file || !range) return null;

  return {
    file,
    start: range.start || {},
    end: range.end || {},
  };
}

function normalizeLine(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 1;
}
