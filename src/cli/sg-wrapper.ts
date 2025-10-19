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

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    funcName: {
      type: "string",
    },
    typeName: {
      type: "string",
    },
    symbol: {
      type: "string",
    },
    mode: {
      type: "string",
    },
    config: {
      type: "string",
    },
    json: {
      type: "string",
    },
    unique: {
      type: "boolean",
    },
    context: {
      type: "string",
    },
    pretty: {
      type: "boolean",
    },
    unified: {
      type: "string",
    },
    format: {
      type: "string",
    },
    native: {
      type: "boolean",
    },
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
if (mode && mode !== "definition" && mode !== "usage" && mode !== "usage-expanded") {
  console.error("error: --mode must be 'definition', 'usage', or 'usage-expanded'");
  process.exitCode = 1;
  process.exit();
}

// Validate that symbol is provided when using mode-based search
if (!values.symbol && (mode || (!values.funcName && !values.typeName))) {
  console.error("error: --symbol is required when using --mode or when no other substitution is provided");
  process.exitCode = 1;
  process.exit();
}

const funcName = values.funcName ?? "foo";
const typeName = values.typeName ?? "Baz";
const symbol = values.symbol ?? "MySymbol";
const searchMode = (mode ?? "definition") as "definition" | "usage" | "usage-expanded";
const jsonStyle = values.json ?? "stream";
const unique = values.unique !== false; // default true
const contextLines = values.context ? Math.max(0, Number(values.context)) : 6;
const pretty = values.pretty === true;
const unified = (() => {
  const v = values.unified;
  if (v === undefined) return true;
  if (typeof v === "string") {
    const lowered = v.toLowerCase();
    if (lowered === "false") return false;
    if (lowered === "true") return true;
  }
  return Boolean(v);
})();
const format = (values.format as string) ?? "json"; // json | text
const nativeMode = values.native === true;

const replacements: Replacements = {
  __FUNC_NAME__: funcName,
  __TYPE_NAME__: typeName,
  __SYMBOL__: symbol,
};

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

    // Determine filter based on mode and unified setting
    let filterArgs: string[] = [];
    if (unified) {
      filterArgs = ["--filter", "agent-target-usage"];
    } else if (values.symbol) {
      // When using symbol mode, filter by specific rule
      let ruleId: string;
      if (searchMode === "definition") {
        ruleId = "ts-symbol-definition";
      } else if (searchMode === "usage-expanded") {
        ruleId = "ts-symbol-usage-expanded";
      } else {
        ruleId = "ts-symbol-usage";
      }
      filterArgs = ["--filter", `^${ruleId}$`];
    }
    // When using funcName or typeName, don't filter - let all rules run

    const sgArgs = nativeMode
      ? [
          "scan",
          "--config",
          generatedConfigPath,
          ...filterArgs,
          "-C",
          String(contextLines),
          ...positionals.map((path) => resolve(path)),
        ]
      : [
          "scan",
          "--config",
          generatedConfigPath,
          `--json=${jsonStyle}`,
          "--include-metadata",
          ...filterArgs,
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

    const proc = Bun.spawn(["sg", ...sgArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve("");
    const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("");
    const exitCode = await proc.exited;
    if (stdoutPromise) {
      const output = await stdoutPromise;
      if (output) {
        if (nativeMode) {
          // passthrough native sg output
          process.stdout.write(output);
        } else {
          // Try to parse JSON stream; if parsing fails, fallback to passthrough
          const lines = output
            .split("\n")
            .map((l: string) => l.trim())
            .filter((l: string) => l.length > 0);

          let parsed: any[] | null = null;
          try {
            parsed = lines.map((l: string) => JSON.parse(l));
          } catch {
            process.stdout.write(output);
            parsed = null;
          }

          if (parsed) {
            const results = await postProcess(parsed, contextLines, unique, values.symbol ? (searchMode === "usage-expanded" ? "usage" : searchMode) : undefined);
            if (format === "text") {
              for (const r of results) {
                const file = (r.file as string) || (r.path as string) || (r.filePath as string) || "";
                const start = (r as any).snippetStartLine ?? 1;
                const end = (r as any).snippetEndLine ?? start;
                process.stdout.write(`path: ${file}  lines: ${start}-${end}\n`);
                process.stdout.write("```ts\n");
                process.stdout.write(((r as any).snippet as string) + "\n");
                process.stdout.write("```\n\n");
              }
            } else {
              if (pretty) {
                process.stdout.write(JSON.stringify(results, null, 2) + "\n");
              } else {
                for (const obj of results) {
                  process.stdout.write(JSON.stringify(obj) + "\n");
                }
              }
            }
          }
        }
      }
    }
    if (stderrPromise) {
      const errorOutput = await stderrPromise;
      if (errorOutput) {
        process.stderr.write(errorOutput);
      }
    }

    if (exitCode !== 0) {
      process.exitCode = exitCode;
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

async function postProcess(objs: MatchObj[], ctx: number, dedupe: boolean, mode?: "definition" | "usage") {
  let items: MatchObj[];
  if (dedupe) {
    // Cluster by overlapping line ranges per file and keep the smallest-span representative
    const byFile: Record<
      string,
      Array<{ obj: MatchObj; start: number; end: number; rules: Set<string> }>
    > = {};
    for (const obj of objs) {
      const loc = extractLocation(obj);
      if (!loc || !loc.file) continue;
      const sLine = normalizeLine(loc.start.line);
      const eLine = normalizeLine(loc.end.line);
      const entry = {
        obj,
        start: Math.min(sLine, eLine),
        end: Math.max(sLine, eLine),
        rules: new Set<string>(obj.ruleId ? [obj.ruleId] : []),
      };
      const list = (byFile[loc.file] ||= []);
      // find overlapping cluster
      let merged = false;
      for (const existing of list) {
        const overlap = !(
          entry.end < existing.start || entry.start > existing.end
        );
        if (overlap) {
          // choose smaller span as representative
          const curSpan = entry.end - entry.start;
          const exSpan = existing.end - existing.start;
          if (curSpan < exSpan) {
            existing.obj = obj;
            existing.start = entry.start;
            existing.end = entry.end;
          } else {
            // expand to union to continue grouping
            existing.start = Math.min(existing.start, entry.start);
            existing.end = Math.max(existing.end, entry.end);
          }
          if (obj.ruleId) existing.rules.add(obj.ruleId);
          merged = true;
          break;
        }
      }
      if (!merged) list.push(entry);
    }
    items = Object.values(byFile).flatMap((arr) =>
      arr.map((e) => ({ ...e.obj, ruleIds: [...e.rules] })),
    );
  } else {
    items = objs;
  }

  // Load files and add snippet
  const fileCache = new Map<string, string[]>();
  for (const it of items) {
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
    const from = Math.max(1, Math.min(sLine, eLine) - ctx);
    const to = Math.min(lines.length, Math.max(sLine, eLine) + ctx);
    (it as any).snippetStartLine = from;
    (it as any).snippetEndLine = to;
    (it as any).snippet = lines.slice(from - 1, to).join("\n");
    
    // Transform to opencode tool format only when in symbol mode
    if (mode) {
      const transformed = {
        file: loc.file,
        line: sLine,
        column: normalizeCol(loc.start.column) + 1, // Convert to 1-based indexing
        endLine: eLine,
        endColumn: normalizeCol(loc.end.column) + 1, // Convert to 1-based indexing
        text: extractMatchedText(lines, sLine, eLine, normalizeCol(loc.start.column), normalizeCol(loc.end.column)),
        kind: mode,
        ruleId: it.ruleId || `ts-symbol-${mode}`,
        snippet: lines.slice(from - 1, to).join("\n"),
        snippetStartLine: from,
        snippetEndLine: to,
      };
      
      // Replace the original object with the transformed format
      Object.assign(it, transformed);
    }
  }

  return items;
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

function makeKey(loc: Location): string {
  const bStart = loc.start.byte ?? -1;
  const bEnd = loc.end.byte ?? -1;
  if (bStart !== -1 && bEnd !== -1) {
    return `${loc.file}:${bStart}-${bEnd}`;
  }
  const sL = normalizeLine(loc.start.line);
  const sC = normalizeCol(loc.start.column);
  const eL = normalizeLine(loc.end.line);
  const eC = normalizeCol(loc.end.column);
  return `${loc.file}:${sL}:${sC}-${eL}:${eC}`;
}

function normalizeLine(n: any): number {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "") return Number(n);
  return 1;
}

function normalizeCol(n: any): number {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "") return Number(n);
  return 1;
}

function extractMatchedText(lines: string[], startLine: number, endLine: number, startCol: number, endCol: number): string {
  if (startLine > lines.length || endLine > lines.length) return "";
  
  if (startLine === endLine) {
    const line = lines[startLine - 1] || "";
    return line.slice(Math.max(0, startCol - 1), Math.max(0, endCol - 1));
  }
  
  // Multi-line match
  const firstLine = lines[startLine - 1] || "";
  const lastLine = lines[endLine - 1] || "";
  const middleLines = startLine + 1 < endLine ? lines.slice(startLine, endLine - 1) : [];
  
  return [
    firstLine.slice(Math.max(0, startCol - 1)),
    ...middleLines,
    lastLine.slice(0, Math.max(0, endCol - 1))
  ].join("\n");
}
