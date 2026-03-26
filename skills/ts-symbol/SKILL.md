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
- Prefer JSON output for follow-up filtering; `--json` is already the default

## Commands

```bash
# Find declarations
ts-symbol definition --symbol UserService --root /path/to/repo

# Find usages
ts-symbol usage --symbol UserService --root /path/to/repo

# Explicit lookup mode
ts-symbol lookup --symbol UserService --mode usage --root /path/to/repo

# Narrow follow-up processing with jq
ts-symbol usage --symbol UserService --root /path/to/repo | jq -r '.matches[].absoluteFile'
```

## Working Rules

- Use `definition` first when the user asks about a symbol's source declaration
- Use `usage` first when the user asks about dependents, references, or impact
- Use `lookup` only when the mode must be supplied dynamically
- Treat zero matches as a valid result, not an error
- Fall back to `rg` or broader search when the symbol name is ambiguous, when you need fuzzy discovery rather than exact identifier lookup, or when the syntax is likely outside the tool's rule coverage

## Output Contract

`ts-symbol` returns JSON shaped like:

- `symbol`
- `mode`
- `root`
- `matches[]`
- Each match includes `file`, `absoluteFile`, `startLine`, `endLine`, `ruleId`, and `snippet`

Use `matches: []` to represent a successful search with no results.
