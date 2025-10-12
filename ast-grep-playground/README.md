# ast-grep playground

## Scan all rules
ast-grep scan --rule rules/01-foo-call-as-statement.yml -l ts,tsx src/calls --json=pretty
ast-grep scan --rule rules/01-foo-call-in-var-decl.yml -l ts,tsx src/calls --json=pretty
ast-grep scan --rule rules/01-foo-call-in-assignment.yml -l ts,tsx src/calls --json=pretty
ast-grep scan --rule rules/01-foo-call-in-return.yml -l ts,tsx src/calls --json=pretty
ast-grep scan --rule rules/01-foo-call-in-await.yml -l ts,tsx src/calls --json=pretty
ast-grep scan --rule rules/03-baz-definitions.yml -l ts,tsx src/types --json=pretty
ast-grep scan --rule rules/04-baz-type-identifier.yml -l ts,tsx src/types --json=pretty
ast-grep scan --rule rules/04-baz-in-annotation.yml -l ts,tsx src/types --json=pretty
ast-grep scan --rule rules/04-baz-in-type-arguments.yml -l ts,tsx src/types --json=pretty
ast-grep scan --rule rules/04-baz-in-extends-or-implements.yml -l ts,tsx src/types --json=pretty
ast-grep scan --rule rules/04-baz-in-assertion.yml -l ts,tsx src/types --json=pretty
ast-grep scan --rule rules/05-foo-member-calls.yml -l ts,tsx src/calls --json=pretty

## One-off quick tests (no file on disk)
# (Inline rules are useful for rapid iteration)
ast-grep scan --inline-rules 'language: typescript
id: test-rule
rule:
  pattern: foo($ARGS)' -l ts,tsx src
