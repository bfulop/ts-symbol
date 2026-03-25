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
export type ContextDepth = "basic" | "structural" | "relationships";

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
  usageKind?: UsageKind;
  enclosingSymbol?: EnclosingSymbol;
  ancestorPath?: AncestorPathEntry[];
  contextSymbols?: ContextSymbol[];
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
  contextDepth?: ContextDepth;
  withContextSymbols?: boolean;
  configPath?: string;
};

export type UsageKind =
  | "definition"
  | "call"
  | "import"
  | "reexport"
  | "type_reference"
  | "value_reference"
  | "initializer"
  | "return_value"
  | "jsx_reference"
  | "member_reference"
  | "unknown";

export type EnclosingSymbol = {
  name: string;
  kind:
    | "function"
    | "method"
    | "class"
    | "interface"
    | "type_alias"
    | "const"
    | "let"
    | "var"
    | "component"
    | "unknown";
  startLine: number;
  endLine: number;
};

export type AncestorPathEntry = {
  kind: string;
  name?: string;
  callee?: string;
};

export type ContextSymbol = {
  name: string;
  kind: "call_target" | "value_reference" | "type_reference";
  role:
    | "callee"
    | "argument"
    | "initializer_target"
    | "assigned_value"
    | "returned_symbol"
    | "type_argument"
    | "jsx_tag";
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
  const contextDepth = options.contextDepth ?? "basic";
  const withContextSymbols =
    (options.withContextSymbols ?? false) || contextDepth === "relationships";
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
    const matches = await toMatches(
      parseStream(stdout),
      context,
      displayRoot,
      options.mode,
      contextDepth,
      withContextSymbols,
    );

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
  mode: SymbolLookupMode,
  contextDepth: ContextDepth,
  withContextSymbols: boolean,
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

    const match: SymbolLookupMatch = {
      file: relative(displayRoot, loc.file) || basename(loc.file),
      absoluteFile: loc.file,
      startLine: snippetStart,
      endLine: snippetEnd,
      ruleId: obj.ruleId,
      snippet,
    };

    if (contextDepth === "structural" || withContextSymbols) {
      const structural = buildStructuralContext(
        obj,
        lines,
        mode,
        withContextSymbols,
      );
      if (structural.usageKind) {
        match.usageKind = structural.usageKind;
      }
      if (structural.enclosingSymbol) {
        match.enclosingSymbol = structural.enclosingSymbol;
      }
      if (structural.ancestorPath && structural.ancestorPath.length > 0) {
        match.ancestorPath = structural.ancestorPath;
      }
      if (structural.contextSymbols && structural.contextSymbols.length > 0) {
        match.contextSymbols = structural.contextSymbols;
      }
    }

    matches.push(match);
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

function buildStructuralContext(
  obj: MatchObj,
  lines: string[],
  mode: SymbolLookupMode,
  withContextSymbols: boolean,
): {
  usageKind?: UsageKind;
  enclosingSymbol?: EnclosingSymbol;
  ancestorPath?: AncestorPathEntry[];
  contextSymbols?: ContextSymbol[];
} {
  const loc = extractLocation(obj);
  if (!loc) return {};

  const symbolRef = extractSymbolReference(obj);
  const startLine = toSourceLineNumber(loc.start.line);
  const endLine = toSourceLineNumber(loc.end.line);
  const enclosingSymbol = inferEnclosingSymbol(lines, startLine, endLine);
  const usageKind =
    mode === "definition"
      ? "definition"
      : inferUsageKind(lines, symbolRef, startLine, enclosingSymbol);
  const ancestorPath = inferAncestorPath(
    lines,
    symbolRef,
    startLine,
    mode,
    usageKind,
    enclosingSymbol,
  );
  const contextSymbols = withContextSymbols
    ? inferContextSymbols(
        lines,
        symbolRef,
        startLine,
        usageKind,
        enclosingSymbol,
      )
    : undefined;

  return {
    usageKind,
    enclosingSymbol,
    ancestorPath,
    contextSymbols,
  };
}

function inferContextSymbols(
  lines: string[],
  symbolRef: { line: number; startColumn: number; endColumn: number } | null,
  matchStartLine: number | undefined,
  usageKind: UsageKind,
  enclosingSymbol: EnclosingSymbol | undefined,
): ContextSymbol[] | undefined {
  const lineNumber = symbolRef?.line ?? normalizeLine(matchStartLine);
  const line = lines[lineNumber - 1] ?? "";
  const symbolName = extractSymbolNameFromLine(line, symbolRef);
  const symbols: ContextSymbol[] = [];

  const push = (entry: ContextSymbol | undefined) => {
    if (!entry) return;
    if (
      symbols.some(
        (candidate) =>
          candidate.name === entry.name &&
          candidate.kind === entry.kind &&
          candidate.role === entry.role,
      )
    ) {
      return;
    }
    symbols.push(entry);
  };

  if (
    enclosingSymbol &&
    ["const", "let", "var", "component"].includes(enclosingSymbol.kind)
  ) {
    const declarationLine = lines[Math.max(0, enclosingSymbol.startLine - 1)] ?? "";
    if (usageKind === "initializer" || declarationLine.includes("=")) {
      push({
        name: enclosingSymbol.name,
        kind: "value_reference",
        role: "initializer_target",
      });
    }
  }

  if (usageKind === "return_value" && symbolName) {
    push({
      name: symbolName,
      kind: "value_reference",
      role: "returned_symbol",
    });
  }

  if (usageKind === "jsx_reference" && symbolName) {
    push({
      name: symbolName,
      kind: "value_reference",
      role: "jsx_tag",
    });
  }

  if (usageKind === "type_reference" && symbolName && line.includes(`<${symbolName}`)) {
    push({
      name: symbolName,
      kind: "type_reference",
      role: "type_argument",
    });
  }

  const callMatch = line.match(/([A-Za-z_$][\w$.]*)\s*\(([^()]*)\)/);
  if (callMatch) {
    const [, rawCallee, rawArgs] = callMatch;
    const calleeName = rawCallee.split(".").pop();
    if (calleeName) {
      push({
        name: calleeName,
        kind: "call_target",
        role: "callee",
      });
    }

    for (const arg of extractDirectIdentifierArguments(rawArgs)) {
      push({
        name: arg,
        kind: "value_reference",
        role: "argument",
      });
    }
  }

  return symbols.length > 0 ? symbols.slice(0, 4) : undefined;
}

function extractDirectIdentifierArguments(rawArgs: string): string[] {
  if (!rawArgs.trim()) return [];

  const values: string[] = [];
  for (const arg of rawArgs.split(",")) {
    const normalized = arg.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(normalized)) {
      values.push(normalized);
    }
  }

  return values;
}

function inferAncestorPath(
  lines: string[],
  symbolRef: { line: number; startColumn: number; endColumn: number } | null,
  matchStartLine: number | undefined,
  mode: SymbolLookupMode,
  usageKind: UsageKind,
  enclosingSymbol: EnclosingSymbol | undefined,
): AncestorPathEntry[] | undefined {
  const lineNumber = symbolRef?.line ?? normalizeLine(matchStartLine);
  const line = lines[lineNumber - 1] ?? "";
  const path: AncestorPathEntry[] = [];

  if (/^\s*import\b/.test(line)) {
    path.push({ kind: "ImportDeclaration" });
  } else if (/^\s*export\s*{/.test(line)) {
    path.push({ kind: "ExportNamedDeclaration" });
  } else if (/^\s*export\b/.test(line)) {
    path.push({ kind: "ExportNamedDeclaration" });
  }

  if (enclosingSymbol) {
    path.push(toDeclarationPathEntry(enclosingSymbol));
  }

  const leaf = inferUsagePathLeaf(
    line,
    symbolRef,
    usageKind,
    mode,
    enclosingSymbol,
  );
  if (leaf) {
    path.push(leaf);
  }

  return path.length > 0 ? path : undefined;
}

function toDeclarationPathEntry(
  enclosingSymbol: EnclosingSymbol,
): AncestorPathEntry {
  switch (enclosingSymbol.kind) {
    case "function":
      return { kind: "FunctionDeclaration", name: enclosingSymbol.name };
    case "method":
      return { kind: "MethodDefinition", name: enclosingSymbol.name };
    case "class":
      return { kind: "ClassDeclaration", name: enclosingSymbol.name };
    case "interface":
      return { kind: "InterfaceDeclaration", name: enclosingSymbol.name };
    case "type_alias":
      return { kind: "TypeAliasDeclaration", name: enclosingSymbol.name };
    case "const":
    case "let":
    case "var":
    case "component":
      return { kind: "VariableDeclarator", name: enclosingSymbol.name };
    default:
      return { kind: "UnknownDeclaration", name: enclosingSymbol.name };
  }
}

function inferUsagePathLeaf(
  line: string,
  symbolRef: { line: number; startColumn: number; endColumn: number } | null,
  usageKind: UsageKind,
  mode: SymbolLookupMode,
  enclosingSymbol: EnclosingSymbol | undefined,
): AncestorPathEntry | undefined {
  const symbolName = extractSymbolNameFromLine(line, symbolRef);
  if (mode === "definition") {
    return symbolName
      ? { kind: "Identifier", name: symbolName }
      : { kind: "Identifier" };
  }

  switch (usageKind) {
    case "import":
      return symbolName
        ? { kind: "ImportSpecifier", name: symbolName }
        : { kind: "ImportSpecifier" };
    case "reexport":
      return symbolName
        ? { kind: "ExportSpecifier", name: symbolName }
        : { kind: "ExportSpecifier" };
    case "call":
      return symbolName
        ? { kind: "CallExpression", callee: symbolName }
        : { kind: "CallExpression" };
    case "jsx_reference":
      return symbolName
        ? { kind: "JSXOpeningElement", name: symbolName }
        : { kind: "JSXOpeningElement" };
    case "type_reference":
      return { kind: "TSTypeReference", name: symbolName };
    case "member_reference":
      return symbolName
        ? { kind: "MemberExpression", name: symbolName }
        : { kind: "MemberExpression" };
    case "initializer":
      if (enclosingSymbol) {
        return { kind: "VariableDeclarator", name: enclosingSymbol.name };
      }
      return { kind: "AssignmentExpression" };
    case "return_value":
      return { kind: "ReturnStatement", name: symbolName };
    case "value_reference":
      return symbolName
        ? { kind: "Identifier", name: symbolName }
        : { kind: "Identifier" };
    default:
      return { kind: "Identifier", name: symbolName };
  }
}

function extractSymbolNameFromLine(
  line: string,
  symbolRef: { startColumn: number; endColumn: number } | null,
): string | undefined {
  if (!symbolRef) return undefined;
  const value = line.slice(symbolRef.startColumn, symbolRef.endColumn).trim();
  return value.length > 0 ? value : undefined;
}

function extractSymbolReference(
  obj: MatchObj,
): { line: number; startColumn: number; endColumn: number } | null {
  const labels = Array.isArray(obj.labels) ? obj.labels : [];
  const secondary = labels.find((label) => label?.style === "secondary");
  const start = secondary?.range?.start;
  const end = secondary?.range?.end;
  if (start && end) {
    return {
      line: toSourceLineNumber(start.line),
      startColumn: normalizeColumn(start.column),
      endColumn: normalizeColumn(end.column),
    };
  }

  const vars = (obj.metaVariables as any)?.multi?.secondary;
  const fallback = Array.isArray(vars) ? vars[0] : undefined;
  if (fallback?.range?.start && fallback?.range?.end) {
    return {
      line: toSourceLineNumber(fallback.range.start.line),
      startColumn: normalizeColumn(fallback.range.start.column),
      endColumn: normalizeColumn(fallback.range.end.column),
    };
  }

  return null;
}

function inferUsageKind(
  lines: string[],
  symbolRef: { line: number; startColumn: number; endColumn: number } | null,
  matchStartLine: number | undefined,
  enclosingSymbol: EnclosingSymbol | undefined,
): UsageKind {
  const lineNumber = symbolRef?.line ?? normalizeLine(matchStartLine);
  const line = lines[lineNumber - 1] ?? "";
  const before = line.slice(0, symbolRef?.startColumn ?? 0);
  const after = line.slice(symbolRef?.endColumn ?? 0);
  const trimmedBefore = before.trimEnd();
  const trimmedAfter = after.trimStart();

  if (/^\s*import\b/.test(line)) return "import";
  if (/^\s*export\s*{/.test(line)) return "reexport";
  if (
    /\bextends\s*$/.test(trimmedBefore) ||
    /\bimplements\s*$/.test(trimmedBefore) ||
    /\bas\s*$/.test(trimmedBefore) ||
    /\bsatisfies\s*$/.test(trimmedBefore) ||
    /:\s*$/.test(trimmedBefore) ||
    /<\s*$/.test(trimmedBefore)
  ) {
    return "type_reference";
  }
  if (/<(?:[A-Z][\w$]*\.)?$/.test(trimmedBefore) || /^(\s|\/|>)/.test(trimmedAfter)) {
    return "jsx_reference";
  }
  if (/[.?]$/.test(trimmedBefore)) return "member_reference";
  if (trimmedAfter.startsWith("(") || /\bnew\s+$/.test(trimmedBefore)) return "call";
  if (/\breturn\b/.test(trimmedBefore)) return "return_value";
  if (
    enclosingSymbol &&
    ["const", "let", "var", "component"].includes(enclosingSymbol.kind) &&
    /=/.test(line)
  ) {
    return "initializer";
  }
  if (/=/.test(line)) return "initializer";
  return "value_reference";
}

function inferEnclosingSymbol(
  lines: string[],
  startLine: number | undefined,
  endLine: number | undefined,
): EnclosingSymbol | undefined {
  const firstLine = lines[Math.max(0, normalizeLine(startLine) - 1)] ?? "";
  const decl = inferDeclarationFromLine(
    firstLine,
    normalizeLine(startLine),
    normalizeLine(endLine),
    lines,
  );
  if (decl) return decl;

  const lineNumber = normalizeLine(startLine);
  for (let index = lineNumber - 1; index >= Math.max(0, lineNumber - 25); index -= 1) {
    const candidate = inferDeclarationFromLine(
      lines[index] ?? "",
      index + 1,
      index + 1,
      lines,
    );
    if (candidate) return candidate;
  }

  return undefined;
}

function inferDeclarationFromLine(
  line: string,
  startLine: number,
  endLine: number,
  lines: string[] = [],
): EnclosingSymbol | undefined {
  const variable = line.match(
    /^\s*(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\b/,
  );
  if (variable) {
    const [, kind, name] = variable;
    return {
      name,
      kind: inferVariableKind(kind as "const" | "let" | "var", name, line),
      startLine,
      endLine,
    };
  }

  const fn = line.match(
    /^\s*(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/,
  );
  if (fn) {
    const [, name] = fn;
    return {
      name,
      kind: inferFunctionKind(lines, name, startLine),
      startLine,
      endLine,
    };
  }

  const klass = line.match(/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
  if (klass) {
    return { name: klass[1], kind: "class", startLine, endLine };
  }

  const iface = line.match(/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/);
  if (iface) {
    return { name: iface[1], kind: "interface", startLine, endLine };
  }

  const typeAlias = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/);
  if (typeAlias) {
    return { name: typeAlias[1], kind: "type_alias", startLine, endLine };
  }

  const method = line.match(
    /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\(/,
  );
  if (method) {
    return { name: method[1], kind: "method", startLine, endLine };
  }

  return undefined;
}

function inferVariableKind(
  keyword: "const" | "let" | "var",
  name: string,
  line: string,
): EnclosingSymbol["kind"] {
  if (keyword === "const" && isComponentName(name) && (line.includes("=>") || line.includes("<"))) {
    return "component";
  }
  return keyword;
}

function inferFunctionKind(
  lines: string[],
  name: string,
  startLine: number,
): EnclosingSymbol["kind"] {
  if (isComponentName(name) && hasNearbyJsx(lines, startLine)) {
    return "component";
  }
  return "function";
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function hasNearbyJsx(lines: string[], startLine: number): boolean {
  const jsxPattern = /<\/?[A-Za-z][\w.: -]*[/> ]/;
  const begin = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, begin + 12);

  for (let index = begin; index < end; index += 1) {
    if (jsxPattern.test(lines[index] ?? "")) {
      return true;
    }
  }

  return false;
}

function normalizeColumn(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function toSourceLineNumber(value: unknown): number {
  return normalizeLine(value) + 1;
}
