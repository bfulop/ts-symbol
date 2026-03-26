# ts-symbol

`ts-symbol` is a Bun-first CLI for syntactic TypeScript symbol lookup powered by [ast-grep](https://ast-grep.github.io/). It finds declarations and usages without starting an LSP or compiling the project.

## Why

This tool is optimized for coding agents and quick codebase analysis:

- fast startup on large codebases
- no `tsconfig.json` or dependency install required in the target path
- stable JSON output for machine handling
- reusable OpenCode adapter on top of the same scan engine

## Install

```bash
git clone https://github.com/your-org/ts-symbol.git
cd ts-symbol
bun install

# ast-grep is still an external dependency
brew install ast-grep
# or: cargo install ast-grep
```

## CLI

The public command is `ts-symbol`.

The CLI now supports progressive disclosure:

- default mode for exact symbol matches
- structural context for faster triage
- bounded relationship context for deeper local inspection

```bash
# Help
bun run ts-symbol help

# Definitions
bun run ts-symbol definition --symbol UserService --root /absolute/path/to/project

# Usages
bun run ts-symbol usage --symbol UserService --root /absolute/path/to/project

# Generic lookup form
bun run ts-symbol lookup --symbol UserService --mode usage --root /absolute/path/to/project

# Structural triage
bun run ts-symbol usage --symbol UserService --root /absolute/path/to/project --context

# Deeper local relationship context
bun run ts-symbol usage --symbol UserService --root /absolute/path/to/project --with-context-symbols

# Human-readable output with surrounding lines
bun run ts-symbol usage --symbol UserService --root /absolute/path/to/project --format pretty --context --snippet-context 2
```

### Commands

- `ts-symbol help`
- `ts-symbol definition --symbol <name> --root <path>`
- `ts-symbol usage --symbol <name> --root <path>`
- `ts-symbol lookup --symbol <name> --mode definition|usage --root <path>`

`--root` is a filesystem path. Pass an absolute path to either:

- a project directory to scan
- a single `.ts` or `.tsx` file to scan

Do not treat `root` as a package name, repo identifier, or remote location. If a project uses shorthand names for codebases, resolve them first using that project's docs, `AGENTS.md`, or skill files, then pass the resulting absolute path. If omitted, the CLI uses the current working directory.

### Options

- `--json`
  `json` is the default output mode and is intended for agents.
- `--format pretty`
  returns fenced code blocks with `// path: ...` headers for humans. When structural context is enabled, pretty output also includes comment summaries such as `usageKind`, `enclosingSymbol`, `ancestorPath`, `contextSymbols`, and selected notes like `import-only usage`.
- `--context`
  enables structural context on matches for faster triage. In JSON this adds fields on each match; in pretty mode it adds comment summaries ahead of the snippet.
- `--snippet-context <N>`
  expands each snippet by `N` lines of context on both sides.
- `--context-depth structural`
  adds `usageKind`, `enclosingSymbol`, and `ancestorPath` to JSON matches.
- `--context-depth relationships`
  adds the structural fields plus bounded `contextSymbols` for adjacent identifiers.
- `--with-context-symbols`
  enables bounded `contextSymbols` and currently implies structural context.
- `--config <path>`
  advanced override for rule development; normal usage should rely on the bundled rules.

## Recommended Workflow

1. Start with exact `definition` or `usage` output.
2. If there are many matches, rerun with `--context` and triage by `usageKind` and `enclosingSymbol`.
3. If you still need to understand the local expression, rerun with `--with-context-symbols`.
4. Use `--format pretty` and `--snippet-context <N>` when a human needs to inspect the result directly.

## Tool Contract For Agents

Use this tool before broad text search when you need TypeScript symbol lookup.

- Start with `definition` for “where is this declared?”
- Use `usage` for dependency impact, refactors, and call-site discovery
- Add `--context` when you need to answer “what kind of usage is this?” or “what contains this usage?”
- Add `--with-context-symbols` or `--context-depth relationships` only when bounded local relationship context is worth the extra noise
- Prefer `--json` so results can be filtered or ranked programmatically
- Treat `matches: []` as a successful zero-result response
- Fall back to text search only when the symbol name is ambiguous or the syntactic rules are known not to cover the pattern
- Remember the tool is syntactic, not semantic: no type resolution, import chasing, or dependency graph expansion

### JSON shape

Default result:

```json
{
  "symbol": "UserService",
  "mode": "usage",
  "root": "/absolute/path/to/project",
  "matches": [
    {
      "file": "src/user.ts",
      "absoluteFile": "/absolute/path/to/project/src/user.ts",
      "startLine": 10,
      "endLine": 10,
      "ruleId": "ts-symbol-usage",
      "snippet": "new UserService(db)"
    }
  ]
}
```

With `--context`:

```json
{
  "symbol": "UserService",
  "mode": "usage",
  "root": "/absolute/path/to/project",
  "matches": [
    {
      "file": "src/user.ts",
      "absoluteFile": "/absolute/path/to/project/src/user.ts",
      "startLine": 10,
      "endLine": 10,
      "ruleId": "ts-symbol-usage",
      "snippet": "const service = new UserService(db)",
      "usageKind": "initializer",
      "enclosingSymbol": {
        "name": "buildUserScreen",
        "kind": "function",
        "startLine": 5,
        "endLine": 22
      },
      "ancestorPath": [
        { "kind": "FunctionDeclaration", "name": "buildUserScreen" },
        { "kind": "VariableDeclarator", "name": "service" }
      ]
    }
  ]
}
```

With `--with-context-symbols` or `--context-depth relationships`, each match may also include:

- `contextSymbols`

### Match fields

Base fields on every match:

- `file`
- `absoluteFile`
- `startLine`
- `endLine`
- `ruleId`
- `snippet`

Structural fields added by `--context` or `--context-depth structural`:

- `usageKind`
- `enclosingSymbol`
- `ancestorPath`

Relationship field added by `--with-context-symbols` or `--context-depth relationships`:

- `contextSymbols`

### Context semantics

- `usageKind` classifies the syntactic role of the match, such as `call`, `import`, `reexport`, `type_reference`, `value_reference`, `initializer`, `return_value`, `jsx_reference`, or `member_reference`
- `enclosingSymbol` identifies the nearest meaningful declaration that contains the match
- `ancestorPath` exposes a concise structural path for machine triage and debugging
- `contextSymbols` lists a small, bounded set of adjacent identifiers relevant to the matched expression

### Skill guidance

A reusable agent instruction file is available at [skills/ts-symbol/SKILL.md](/Users/balint.fulop/Work2/astGrep/skills/ts-symbol/SKILL.md).

## OpenCode Adapter

The repository still exports `findDefinition` and `findUsage` from [ts-symbol.ts](/Users/balint.fulop/Work2/astGrep/ts-symbol.ts), but they now call the same shared scan engine as the CLI.

The adapter is intentionally opinionated:

- it defaults `root` to `~/Work/pulsar`
- it returns pretty text blocks, not the JSON payload shape shown above
- each block starts with a `// path: ...` header followed by the matched snippet

```typescript
import { findDefinition, findUsage } from "./ts-symbol";

const definitions = await findDefinition.execute({
  symbol: "UserService",
  root: "~/Work/my-project",
});

const usages = await findUsage.execute({
  symbol: "UserService",
  root: "~/Work/my-project",
});
```

## Supported Symbol Types

Definitions currently include:

- function declarations
- variable declarations
- class declarations
- interface declarations
- type aliases
- enum declarations
- method definitions
- property signatures
- export specifiers
- type parameters

Usage lookup currently covers symbols appearing in:

- function and method bodies
- class, interface, and type declarations
- type annotations and generic arguments
- variable initializers
- top-level expression statements

## Architecture

```text
ts-symbol/
├── src/lib/ts-symbol-scan.ts   shared scan engine and formatting
├── src/cli/ts-symbol.ts        public CLI entrypoint
├── src/cli/sg-wrapper.ts       legacy compatibility wrapper
├── ts-symbol.ts                OpenCode adapter
├── ast-grep-playground/        bundled ast-grep config and rules
└── skills/ts-symbol/SKILL.md   agent instructions
```

## Limitations

- purely syntactic matching; no type resolution
- no import chasing to original definitions
- common symbol names can produce false positives

## Development

```bash
bun test
bun test tests/sg-wrapper.test.ts
```

## Requirements

- [Bun](https://bun.sh/)
- [ast-grep](https://ast-grep.github.io/) with `sg` on `PATH`

## License

MIT
