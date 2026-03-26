---
name: ts-symbol
description: AST-aware TypeScript symbol lookup with the `ts-symbol` CLI. Use for TypeScript codebase work when a task asks where a named symbol is defined, used, imported, re-exported, or what depends on it. Prefer this skill before `rg`, `grep`, or `ls` when the request is about a specific TypeScript identifier, including early project exploration.
---

# ts-symbol

Use `ts-symbol` first for exact TypeScript symbol questions.

Use it when you need exact declaration, reference, import, export, or impact information for a named TypeScript symbol.

Do not start with `rg`, `grep`, or `ls` when a named TypeScript symbol is already known and the task is symbol lookup rather than fuzzy discovery.

## Commands

- `ts-symbol definition --symbol UserService --root /absolute/path`
- `ts-symbol usage --symbol UserService --root /absolute/path`
- `ts-symbol lookup --symbol UserService --mode usage --root /absolute/path`

`--root` is a filesystem path. Pass an absolute project path when searching outside the current directory.

## Options

- `--json` default output for machine handling
- `--format pretty` human-readable snippets
- `--context` add structural match metadata
- `--snippet-context N` expand surrounding snippet lines
- `--context-depth basic|structural|relationships` control context detail
- `--with-context-symbols` add bounded nearby symbols and imply structural context
- `--config <path>` advanced custom rule override

## Notes

- `matches: []` is a successful zero-result lookup.
- The tool is syntactic, not semantic. It does not do type resolution or import chasing.
- Read [README.md](/Users/balint.fulop/Work2/astGrep/README.md) or run `ts-symbol --help` if you need option details.
