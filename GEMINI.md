# Gemini Code Assist Rules — Rule Harness Repo

## Commit Discipline
- **Commit after every atomic unit of change.** Never batch unrelated changes into one commit.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Commit body explains *why*, not just what.

## SOLID Principles
- **Single Responsibility** — Each module owns exactly one concern. `engine.ts` = rule dispatch. `agent.ts` = tool-use loop. `src/rules/*.ts` = pure checker functions. Don't blend these.
- **Open/Closed** — Extend with new rule types by adding files + extending the `Rule` union. Existing code is closed to modification.
- **Liskov** — Every rule checker must conform to `(rule, action) => RuleViolation | null`. No side effects, no exceptions to this signature.
- **Interface Segregation** — Rule-specific fields belong on the specific rule interface (e.g., `CommandGateRule`), not on `BaseRule`.
- **Dependency Inversion** — `RuleEngine` depends on abstractions (`Rule[]`), not on specific checker implementations by name.

## KISS
- Simplest implementation that solves the problem. No speculative abstraction.
- Flat over nested. Function over class when state isn't needed. Switch over factory pattern unless the list is >5 and growing.
- Every abstraction added should have a clear reason stated in the commit message.

## Clean Code Standards
- Functions: max ~40 lines, max 2 levels of nesting.
- Names: describe what a thing IS, not what it does. `RuleViolation`, `TaskContext`, not `RuleCheckResult`, `AgentState`.
- No `any` without an inline comment explaining why it's unavoidable.
- Error handling: explicit, never silently swallowed.
- No global mutable state.

## Architecture Boundaries (hard rules)
| File | Allowed | NOT Allowed |
|------|---------|-------------|
| `src/rules/*.ts` | Pure functions, types | I/O, side effects, `async` (except command-gate) |
| `src/engine.ts` | Dispatch, retry budget | Business logic, I/O |
| `src/agent.ts` | Tool loop, file I/O, subprocesses | Rule logic |
| `src/types.ts` | Type definitions | Any logic |
| `src/cli.ts` | Arg parsing, wiring | Business logic |

## TypeScript
- Strict mode. Resolve type errors properly; don't cast around them.
- Use `.js` extensions in imports (ESM module mode).
- No `process.exit()` outside `cli.ts`.
- No new runtime dependencies without a clear justification comment.
