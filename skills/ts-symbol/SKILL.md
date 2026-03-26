---
name: ts-symbol
description: Use the ts-symbol CLI to locate TypeScript or TSX symbol definitions and usages with AST-aware matching. Trigger this skill when Codex needs to answer questions like where a symbol is declared, where it is used, what depends on it, or which files reference a TypeScript identifier, and prefer it before broad text search in TypeScript codebases.
---

# ts-symbol

Use `ts-symbol` before `rg` or generic grep when the task is specifically about a TypeScript symbol declaration or reference.

## Quick Start

- Run `ts-symbol definition` for questions like "where is this declared?"
- Run `ts-symbol usage` for questions like "where is this used?" or "what depends on this?"
- Pass `--root` explicitly when searching outside the current working directory
- `--root` should be an absolute filesystem path to either a project directory or a single `.ts`/`.tsx` file
- Do not treat `root` as a package name or repo identifier; if the project uses logical names, resolve them first from that project's docs, `AGENTS.md`, or skill files
- Prefer JSON output for follow-up filtering; `--json` is already the default
- Add `--context` when you need to classify matches before opening files
- Add `--with-context-symbols` or `--context-depth relationships` only for deeper local relationship triage

## Commands

```bash
# Find declarations
ts-symbol definition --symbol UserService --root /absolute/path/to/project

# Find usages
ts-symbol usage --symbol UserService --root /absolute/path/to/project

# Explicit lookup mode
ts-symbol lookup --symbol UserService --mode usage --root /absolute/path/to/project

# Structural triage
ts-symbol usage --symbol UserService --root /absolute/path/to/project --context

# Deeper local relationship context
ts-symbol usage --symbol UserService --root /absolute/path/to/project --with-context-symbols

# Human-readable review with surrounding lines
ts-symbol usage --symbol UserService --root /absolute/path/to/project --format pretty --context --snippet-context 2

# Narrow follow-up processing with jq
ts-symbol usage --symbol UserService --root /absolute/path/to/project --context | jq -r '.matches[] | [.usageKind, .absoluteFile, .startLine] | @tsv'
```

## Working Rules

- Use `definition` first when the user asks about a symbol's source declaration
- Use `usage` first when the user asks about dependents, references, or impact
- Use `lookup` only when the mode must be supplied dynamically
- Default to exact-match output first; only add context when it will reduce follow-up file reads
- Use `--context` for codebase research when you need to answer "what kind of usage is this?" or "what contains this usage?"
- Use `--with-context-symbols` or `--context-depth relationships` when you need a small, bounded set of adjacent identifiers around each match
- Use `--format pretty` when a human will inspect the output directly; when context is enabled it also prints comment summaries like `usageKind`, `enclosingSymbol`, `ancestorPath`, and `contextSymbols`
- Stay with JSON for agent filtering and ranking
- Use `--snippet-context <N>` when the snippet is too tight to understand the local statement or declaration
- Treat zero matches as a valid result, not an error
- Fall back to `rg` or broader search when the symbol name is ambiguous, when you need fuzzy discovery rather than exact identifier lookup, or when the syntax is likely outside the tool's rule coverage
- Remember the tool is syntactic, not semantic: no type resolution, import chasing, or dependency graph expansion

## Output Contract

`ts-symbol` returns JSON shaped like:

- `symbol`
- `mode`
- `root`
- `matches[]`
- Each match includes `file`, `absoluteFile`, `startLine`, `endLine`, `ruleId`, and `snippet`
- `--context` adds structural fields intended for fast triage
- In pretty mode, the same structural data is rendered as comment summaries above each snippet
- `--with-context-symbols` adds bounded local relationship data and currently implies structural context

Use `matches: []` to represent a successful search with no results.

## Match Fields

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

## Recommended Workflow

1. Start with exact `definition` or `usage` output.
2. If there are many matches, rerun with `--context` and group or rank by `usageKind` and `enclosingSymbol`.
3. If you still need to understand the local expression without opening the file, rerun with `--with-context-symbols`.
4. Only fall back to broad text search if exact symbol lookup is the wrong tool for the question.

## Context Semantics

- `usageKind` classifies the syntactic role of the match, such as `call`, `import`, `reexport`, `type_reference`, `value_reference`, `initializer`, `return_value`, `jsx_reference`, or `member_reference`
- `enclosingSymbol` identifies the nearest meaningful declaration that contains the match, with `name`, `kind`, `startLine`, and `endLine`
- `ancestorPath` is a concise structural path for machine triage; use it when you need to distinguish wrappers like exports, variable declarators, or call expressions
- `contextSymbols` is intentionally small and local; it helps answer "what other nearby symbols matter here?" without recursive expansion

## Agent Heuristics

- For refactors or impact analysis, prefer `usage --context` before opening many files
- For import-cleanup or API migration work, use `usageKind` to separate `import` and `reexport` matches from runtime usages
- For React-heavy code, `enclosingSymbol.kind: "component"` and `usageKind: "jsx_reference"` are strong signals that a usage sits in render flow
- For machine post-processing, filter JSON first and only open the handful of files that remain interesting
