# ts-symbol

A fast TypeScript symbol lookup tool powered by [ast-grep](https://ast-grep.github.io/). Find definitions and usages across any TypeScript codebase without requiring a Language Server Protocol (LSP) or the TypeScript compiler.

## Why?

Traditional symbol lookup requires running a full LSP, which needs project initialization, dependency resolution, and significant memory overhead. This approach is often too slow or impractical for:

- **AI coding agents** that need quick code context across multiple repositories
- **Large monorepos** where LSP initialization takes too long
- **Cross-repository searches** where maintaining multiple LSP instances is expensive

**ts-symbol** uses [ast-grep](https://ast-grep.github.io/) to perform purely syntactic AST matching via Tree-sitter grammars. This means instant results with zero project setup—just point it at any TypeScript code.

## Features

- **Find definitions** - Locate where symbols are declared (functions, classes, interfaces, types, enums, variables)
- **Find usages** - Discover all references to a symbol across the codebase
- **No compilation required** - Works on any TypeScript/TSX code without `tsconfig.json` or `node_modules`
- **Structured output** - Returns code blocks with file paths and line numbers for easy navigation
- **OpenCode integration** - Ships as a custom tool for AI agent workflows

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/ts-symbol.git
cd ts-symbol

# Install dependencies (requires Bun)
bun install

# Ensure ast-grep is installed
brew install ast-grep  # macOS
# or: cargo install ast-grep
```

## Usage

### CLI

```bash
# Find all definitions of a symbol
bun run src/cli/sg-wrapper.ts ./path/to/code \
  --symbol MyFunction \
  --mode definition \
  --config ast-grep-playground/sgconfig.yml

# Find all usages of a symbol
bun run src/cli/sg-wrapper.ts ./path/to/code \
  --symbol MyFunction \
  --mode usage \
  --config ast-grep-playground/sgconfig.yml

# Add context lines around matches
bun run src/cli/sg-wrapper.ts ./path/to/code \
  --symbol MyFunction \
  --mode usage \
  --context 3 \
  --config ast-grep-playground/sgconfig.yml
```

### OpenCode Tool

The repository exports `findDefinition` and `findUsage` as OpenCode-compatible tools:

```typescript
import { findDefinition, findUsage } from "./ts-symbol";

// Find where a symbol is defined
const definitions = await findDefinition.execute({
  symbol: "UserService",
  root: "~/Work/my-project", // optional, defaults to ~/Work/pulsar
});

// Find all usages of a symbol
const usages = await findUsage.execute({
  symbol: "UserService",
  root: "~/Work/my-project",
});
```

### Output Format

Results are returned as markdown code blocks with location headers:

```ts
// path: src/services/user.ts:15-20
export class UserService {
  constructor(private db: Database) {}
  // ...
}
```

## Supported Symbol Types

### Definitions

| Declaration Type | Example |
|-----------------|---------|
| Function declarations | `function foo() {}` |
| Variable declarations | `const foo = ...` / `let foo` / `var foo` |
| Class declarations | `class Foo {}` |
| Interface declarations | `interface Foo {}` |
| Type aliases | `type Foo = ...` |
| Enum declarations | `enum Foo {}` |
| Method definitions | `class X { foo() {} }` |
| Property signatures | `interface X { foo: string }` |
| Export specifiers | `export { foo }` |
| Type parameters | `function foo<T>() {}` |

### Usages

The usage mode finds symbols appearing within:
- Function bodies and method implementations
- Class and interface declarations
- Type annotations and type arguments
- Variable initializers
- Expression statements

## Architecture

```
ts-symbol/
├── ts-symbol.ts              # OpenCode tool exports
├── src/cli/sg-wrapper.ts     # CLI wrapper around ast-grep
├── ast-grep-playground/
│   ├── sgconfig.yml          # ast-grep configuration
│   ├── rules/
│   │   ├── ts-symbol-definition.yml      # Definition patterns (.ts)
│   │   ├── ts-symbol-definition-tsx.yml  # Definition patterns (.tsx)
│   │   ├── ts-symbol-usage.yml           # Usage patterns (.ts)
│   │   └── ts-symbol-usage-tsx.yml       # Usage patterns (.tsx)
│   └── utils/                # Shared rule utilities
└── tests/                    # Test suite
```

### How It Works

1. The CLI receives a symbol name and mode (`definition` or `usage`)
2. Rule templates containing `__SYMBOL__` placeholders are copied to a temp directory with substitutions applied
3. ast-grep scans the target codebase using Tree-sitter's TypeScript grammar
4. Matches are filtered by rule ID and formatted as code blocks with location metadata

## Limitations

- **Syntactic matching only** - No type inference or cross-file type resolution. A search for `foo` will match any symbol literally named `foo`, regardless of scope or type.
- **No import resolution** - Cannot follow imports to find the original definition in another file.
- **Pattern-based** - May produce false positives for common symbol names. Use specific, unique names for best results.

## Development

```bash
# Run tests
bun test

# Run a specific test file
bun test tests/sg-wrapper.test.ts
```

## Requirements

- [Bun](https://bun.sh/) v1.0+
- [ast-grep](https://ast-grep.github.io/) (`sg` binary in PATH)

## License

MIT
