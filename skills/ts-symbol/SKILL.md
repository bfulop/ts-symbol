# ts-symbol

Use `ts-symbol` before broad text search when you need TypeScript declarations or usages.

## Guidance

- Use `definition` to answer “where is this declared?”
- Use `usage` to answer “what depends on this?”
- Prefer `--json` for machine handling and follow-up filtering
- Fall back to plain text search when the symbol is ambiguous or you expect syntax the rules do not cover

## Commands

```bash
# Find declarations
bun run ts-symbol definition --symbol UserService --root /path/to/repo

# Find usages
bun run ts-symbol usage --symbol UserService --root /path/to/repo

# Explicit lookup mode
bun run ts-symbol lookup --symbol UserService --mode usage --root /path/to/repo --json

# Process with jq
bun run ts-symbol lookup --symbol UserService --mode usage --root /path/to/repo --json | jq '.matches[].file'
```

## Output contract

`--json` returns:

- `symbol`
- `mode`
- `root`
- `matches[]`
- each match contains `file`, `absoluteFile`, `startLine`, `endLine`, `ruleId`, and `snippet`

Zero matches is a successful response with `matches: []`.
