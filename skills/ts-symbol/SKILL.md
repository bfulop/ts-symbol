---
name: ts-symbol
description: AST-aware TypeScript symbol lookup with the `ts-symbol` CLI. Use for TypeScript codebase work when a task asks where a named symbol is defined, used, imported, re-exported, or what depends on it. Prefer this skill before `rg`, `grep`, or `ls` when the request is about a specific TypeScript identifier, including early project exploration.
---

# ts-symbol

**Use `ts-symbol` first** when a task involves a known TypeScript symbol name — before `rg`, `grep`, or file reading.

## Why ts-symbol over text search

- **AST-aware**: matches the identifier as a syntactic construct, not a substring. No false positives from comments, strings, or partial names.
- **Fast startup**: no LSP, no compiler, no `tsconfig.json` or dependency install required. Works immediately on any codebase.
- **Stable JSON by default**: output is machine-parseable out of the box — filter, rank, or pipe results programmatically.
- **Progressive detail**: start with exact matches, then layer on structural context and relationship data only when needed.

## Commands

```bash
# Where is it declared?
ts-symbol definition --symbol UserService --root /absolute/path

# Where is it used?
ts-symbol usage --symbol UserService --root /absolute/path
```

`--root` is an absolute filesystem path to a project directory or a single `.ts`/`.tsx` file. Defaults to the current working directory if omitted.

## Workflow: start simple, escalate as needed

**Step 1 — Exact lookup.** Run `definition` or `usage` with no extra flags. This is sufficient for most tasks.

```bash
ts-symbol usage --symbol UserService
```

Each match returns `file`, `startLine`, `endLine`, `snippet`.

**Step 2 — Structural triage.** Add `--context` when there are many matches and you need to classify them.

```bash
ts-symbol usage --symbol UserService --context
```

Each match gains `usageKind` (a string: `call`, `import`, `reexport`, `type_reference`, `value_reference`, `initializer`, `return_value`, `jsx_reference`, `member_reference`) and `enclosingSymbol` (`{ "name": "buildUserScreen", "kind": "function", "startLine": 5, "endLine": 22 }`).

**Step 3 — Local relationships.** Add `--with-context-symbols` when you need to see what other identifiers participate in the matched expression. Implies `--context`.

```bash
ts-symbol usage --symbol UserService --with-context-symbols
```

Each match gains a `contextSymbols` array of `{ "name": string, "kind": string }` for nearby identifiers.

**Step 4 — Human display.** Add `--format pretty` and `--snippet-context 3` when a person needs to read the output.

```bash
ts-symbol usage --symbol UserService --format pretty --snippet-context 3
```

## Notes

- `matches: []` is a successful zero-result lookup, not an error.
- The tool is syntactic (AST pattern matching), not semantic. It does not resolve types or chase imports across files.
- `--context-depth basic|structural|relationships` exists for fine-grained control but the workflow flags above are preferred.
- Run `ts-symbol --help` or read the [README](/Users/balint.fulop/Work2/astGrep/README.md) for full details.
