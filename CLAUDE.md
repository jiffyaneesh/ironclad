# CLAUDE.md — Rule Harness Repo

## Engineering Principles

Follow these without exception. Every PR or commit must reflect them.

### Commit Discipline
- **Commit after every unit of change.** One logical change = one commit. Do not batch unrelated changes.
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Commit message body must say *why*, not just *what*

### SOLID
- **S** — Each module/class does one thing. `engine.ts` checks rules. `agent.ts` runs the loop. Rule checkers are pure functions. Keep them that way.
- **O** — New rule types extend the system (new file in `src/rules/`, new union member in `types.ts`, new branch in `engine.ts`). Do not modify existing checkers to handle new cases.
- **L** — Substitutable rule checkers: every checker `(rule, action) => RuleViolation | null`. Don't break this contract.
- **I** — Don't add fields to `BaseRule` that only one rule type needs. Put them on the specific interface.
- **D** — `RuleEngine` depends on `Rule[]`, not on concrete checker modules. Keep the dispatch in `engine.ts`, not in the checkers.

### KISS
- No abstraction unless it removes real duplication or real complexity. Prefer a plain function over a class, a `switch` over a registry, a flat file over a subdirectory.
- If a PR adds more abstraction than it removes complexity, it's wrong.

### Clean Code
- Name things for what they *are*, not what they *do*: `RuleViolation`, not `RuleCheckOutput`
- Pure functions for all rule checkers — no side effects, no module-level state
- No `any` casts without a comment explaining why it can't be avoided
- Keep functions under ~40 lines. Extract when logic gets nested more than 2 levels deep.
- Error paths must be explicit — never swallow exceptions silently

## Architecture Constraints

- `src/rules/*.ts` — pure checker functions only, no I/O
- `src/engine.ts` — dispatch + retry budget tracking only, no business logic
- `src/agent.ts` — tool-use loop + side effects (file I/O, subprocess)
- `src/types.ts` — types only, no logic
- `src/cli.ts` — arg parsing + wiring only

**Do not put I/O in rule checkers. Do not put business logic in the agent loop.**

## Adding a New Rule Type

1. Add interface to `src/types.ts`, extend `Rule` union
2. Create `src/rules/yourRuleType.ts` — export one pure function `checkYourRuleType(rule, action): RuleViolation | null`
3. Add a branch in `engine.ts` `check()` to call it
4. Add an example entry to `.rules.yaml.example`
5. Commit each step separately

## What NOT to Do

- Do not add runtime dependencies without a clear necessity and a comment
- Do not use `process.exit()` inside library code — only in `cli.ts`
- Do not make rule checkers async unless the rule type requires it (only `command-gate` needs async)
- Do not add global state
