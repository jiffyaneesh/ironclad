# ironclad

A rule-*enforcement* engine for AI coding agents, not another rule-*suggestion*
file. `.rules.yaml` rules are compiled into mechanical checks that run against
every proposed file edit, shell command, and "I'm done" claim — before it's
allowed to take effect. The model never gets to decide whether to comply.

## Why this exists

CLAUDE.md / AGENTS.md-style instruction files are prose competing for the
model's attention inside a shrinking context budget. Compliance falls off a
cliff once you pass roughly 200 lines or 15 rules, because the rules are just
more tokens to (maybe) remember. Ironclad sidesteps that entirely: rules are
code, not context. They don't degrade, because nothing has to "remember"
them — the engine just runs them, every time, deterministically.

It also closes the other big trust gap: agents claiming "tests pass" or
"I checked the docs" without actually doing either. Here, `task_complete` is
a gated action — if a `command-gate` rule (e.g. `npm test`) fails, the
completion claim is rejected outright and the agent is told exactly why.

## Architecture

```
src/
  types.ts          # Rule schema + proposed-action types
  ruleLoader.ts     # Parses .rules.yaml
  engine.ts         # Routes proposed actions through applicable rules,
                    # tracks per-rule retry counts, forces escalation
  rules/
    diffScope.ts    # "only touch declared/allowed files"
    pattern.ts      # forbid/require regex on added lines (real unified diff)
    commandGate.ts  # run a real command, require exit 0
  agent.ts          # Claude tool-use loop; every tool call goes through
                    # the engine before it's executed
  cli.ts            # entry point
```

Flow for a single agent turn:

```
model proposes edit_file / run_command / task_complete
   -> engine.check(action)
        - blocking violation?  -> rejection reason returned to model as a
                                   tool_result error; nothing is written to disk
        - same rule fails > retryBudget times? -> stop the run, escalate to
                                   a human instead of looping forever
        - ok -> action actually executes (file written / command run)
```

## Rule types

| type             | what it checks                                                                   |
|------------------|----------------------------------------------------------------------------------|
| `diff-scope`     | which files may be touched (`declared` = task-scoped, `glob` = pattern-scoped)  |
| `pattern-forbid` | added lines must NOT match a regex (e.g. hardcoded secrets)                      |
| `pattern-require`| added lines must match a regex, optionally only when a trigger pattern is present |
| `command-gate`   | an external command must exit 0 (tests, typecheck, lint) — on edit or completion |

See `.rules.yaml.example` for a working set covering all four.

## Setup

```bash
git clone https://github.com/jiffyaneesh/ironclad.git
cd ironclad
npm install
npm run build
```

Set any of the supported API keys in `.env` or your shell:
- `GEMINI_API_KEY` (defaults to `gemini-2.0-flash`)
- `ANTHROPIC_API_KEY` (defaults to `claude-opus-4-5`)
- `OPENAI_API_KEY` (defaults to `gpt-4o`)

## Interactive CLI Agent

Run without `--task` to enter the interactive conversational harness:

```bash
# Using npm
npm start

# Or using npx/node
node dist/cli.js
```

Inside the interactive harness, you can prompt the agent continuously, inspect rules with `/rules`, switch scope with `/scope <files>`, or reset with `/clear`.

## One-Shot Usage

```bash
node dist/cli.js \
  --task "fix the null pointer bug in the login handler" \
  --files src/auth.ts \
  --rules .rules.yaml \
  --cwd /path/to/your/repo
```

`--files` is the declared scope for `diff-scope: declared` rules — the agent
can only edit files you name here unless a rule says otherwise. This is the
single biggest lever against "agent wandered off and refactored unrelated code."

## Extending ironclad

- **New rule type**: add a variant to the `Rule` union in `types.ts`, a
  checker function in `src/rules/`, and a branch in `engine.ts`. Keep checkers
  pure functions (input: rule + action, output: violation | null) — makes
  them trivial to unit test in isolation.
- **LLM-as-judge for fuzzy rules**: for rules too fuzzy to regex ("matches
  existing code style"), add a rule type that calls a cheap model as an
  advisory (non-blocking) check. Don't make it blocking until you've measured
  its false-positive rate — mechanical checks should always take priority
  over judgment calls for anything block-worthy.
- **Patch-based edits**: `edit_file` does whole-file replace (MVP tradeoff).
  For large files, add a `patch_file` tool that takes a unified diff instead,
  and adjust `diffScope`/`pattern` checkers to operate on the patch's added
  lines directly.

## What ironclad deliberately does NOT do (yet)

- No persistent cross-session memory — each run is a fresh task, same as the
  incumbents. Worth building next if the rule engine proves out.
- No multi-file transactional edits (all-or-nothing across a set of files).
- `command-gate` rules run synchronously and block the loop; fine for
  `npm test`, not fine for a slow integration suite — async/background gating
  is on the roadmap.

## Contributing

Follow the rules in [CLAUDE.md](CLAUDE.md) / [GEMINI.md](GEMINI.md) /
[.cursorrules](.cursorrules): one commit per unit of change, conventional
commit messages, SOLID, KISS.
