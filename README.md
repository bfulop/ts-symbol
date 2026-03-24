# ts-symbol

`ts-symbol` is a Bun-first CLI for syntactic TypeScript symbol lookup powered by [ast-grep](https://ast-grep.github.io/). It finds declarations and usages without starting an LSP or compiling the project.

## Why

This tool is optimized for coding agents and quick repository analysis:

- fast startup on large repos
- no `tsconfig.json` or dependency install required in the target repo
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

```bash
# Definitions
bun run ts-symbol definition --symbol UserService --root /path/to/repo

# Usages
bun run ts-symbol usage --symbol UserService --root /path/to/repo

# Generic lookup form
bun run ts-symbol lookup --symbol UserService --mode usage --root /path/to/repo

# Human-readable output
bun run ts-symbol usage --symbol UserService --root /path/to/repo --format pretty
```

### Commands

- `ts-symbol definition --symbol <name> --root <path>`
- `ts-symbol usage --symbol <name> --root <path>`
- `ts-symbol lookup --symbol <name> --mode definition|usage --root <path>`

### Options

- `--json`
  `json` is the default output mode and is intended for agents.
- `--format pretty`
  returns fenced code blocks with `// path: ...` headers for humans.
- `--context <N>`
  expands each snippet by `N` lines of context on both sides.
- `--config <path>`
  advanced override for rule development; normal usage should rely on the bundled rules.

## Tool Contract For Agents

Use this tool before broad text search when you need TypeScript symbol lookup.

- Start with `definition` for “where is this declared?”
- Use `usage` for dependency impact, refactors, and call-site discovery
- Prefer `--json` so results can be filtered or ranked programmatically
- Treat `matches: []` as a successful zero-result response
- Fall back to text search only when the symbol name is ambiguous or the syntactic rules are known not to cover the pattern

### JSON shape

```json
{
  "symbol": "UserService",
  "mode": "usage",
  "root": "/path/to/repo",
  "matches": [
    {
      "file": "src/user.ts",
      "absoluteFile": "/path/to/repo/src/user.ts",
      "startLine": 10,
      "endLine": 10,
      "ruleId": "ts-symbol-usage",
      "snippet": "new UserService(db)"
    }
  ]
}
```

### Skill guidance

A reusable agent instruction file is available at [skills/ts-symbol/SKILL.md](/Users/balint.fulop/Work2/astGrep/skills/ts-symbol/SKILL.md).

## OpenCode Adapter

The repository still exports `findDefinition` and `findUsage` from [ts-symbol.ts](/Users/balint.fulop/Work2/astGrep/ts-symbol.ts), but they now call the same shared scan engine as the CLI.

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
