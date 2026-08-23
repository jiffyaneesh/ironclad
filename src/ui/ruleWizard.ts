import type * as readline from "node:readline/promises";
import chalk from "chalk";
import yaml from "js-yaml";
import { appendRule } from "../config/rulesManager.js";
import { workspaceRules, GLOBAL_RULES } from "../config/paths.js";
import type {
  Rule,
  DiffScopeRule,
  PatternForbidRule,
  PatternRequireRule,
  CommandGateRule,
} from "../types.js";

type Scope = "workspace" | "global";
type RuleTypeKey = "diff-scope" | "pattern-forbid" | "pattern-require" | "command-gate";

// ── Primitive prompts ──────────────────────────────────────────────────────

async function ask(
  rl: readline.Interface,
  question: string,
  def?: string
): Promise<string> {
  const hint = def !== undefined ? chalk.dim(` [${def || "skip"}]`) : "";
  const ans = await rl.question(`  ${chalk.hex("#E74C3C")("?")}  ${question}${hint}: `);
  return ans.trim() || (def ?? "");
}

async function choose(
  rl: readline.Interface,
  question: string,
  options: string[]
): Promise<number> {
  console.log(`\n  ${chalk.hex("#E74C3C")("?")}  ${question}`);
  options.forEach((o, i) =>
    console.log(`     ${chalk.hex("#C0392B").bold(i + 1 + ".")}  ${o}`)
  );
  while (true) {
    const ans = await rl.question("  › ");
    const n = parseInt(ans.trim(), 10);
    if (n >= 1 && n <= options.length) return n - 1;
    console.log(chalk.dim("     Invalid — enter a number from the list."));
  }
}

// ── Type-specific field prompts ────────────────────────────────────────────

async function buildDiffScopeRule(
  rl: readline.Interface,
  base: Pick<Rule, "id" | "description" | "blocking">
): Promise<DiffScopeRule> {
  const modeIdx = await choose(rl, "Mode:", [
    `declared  ${chalk.dim("— only files explicitly listed in task scope may be edited")}`,
    `glob      ${chalk.dim("— only files matching a glob pattern may be edited")}`,
  ]);
  const mode = modeIdx === 0 ? "declared" : "glob";
  const applies_to =
    mode === "glob" ? await ask(rl, "Glob pattern (e.g. src/**/*.ts)") : undefined;
  return { ...base, type: "diff-scope", mode, ...(applies_to ? { applies_to } : {}) };
}

async function buildPatternForbidRule(
  rl: readline.Interface,
  base: Pick<Rule, "id" | "description" | "blocking">
): Promise<PatternForbidRule> {
  const pattern = await ask(rl, "Forbidden regex (applied to added lines only)");
  const flags   = await ask(rl, "Regex flags", "i");
  const applies_to = await ask(rl, "Limit to glob (leave empty = all files)", "");
  return {
    ...base,
    type: "pattern-forbid",
    pattern,
    ...(flags ? { flags } : {}),
    ...(applies_to ? { applies_to } : {}),
  };
}

async function buildPatternRequireRule(
  rl: readline.Interface,
  base: Pick<Rule, "id" | "description" | "blocking">
): Promise<PatternRequireRule> {
  const pattern         = await ask(rl, "Required regex (must appear in added lines)");
  const trigger_pattern = await ask(rl, "Only enforce when trigger pattern is also added (optional)", "");
  const flags           = await ask(rl, "Regex flags", "");
  const applies_to      = await ask(rl, "Limit to glob (leave empty = all files)", "");
  return {
    ...base,
    type: "pattern-require",
    pattern,
    ...(trigger_pattern ? { trigger_pattern } : {}),
    ...(flags ? { flags } : {}),
    ...(applies_to ? { applies_to } : {}),
  };
}

async function buildCommandGateRule(
  rl: readline.Interface,
  base: Pick<Rule, "id" | "description" | "blocking">
): Promise<CommandGateRule> {
  const command = await ask(rl, "Command to run (must exit 0)", "npm test");
  const triggerIdx = await choose(rl, "When should this gate run?", [
    `on_task_complete  ${chalk.dim("— only when agent declares the task done (recommended)")}`,
    `on_edit           ${chalk.dim("— after every file edit (slower, more thorough)")}`,
  ]);
  const trigger = triggerIdx === 0 ? "on_task_complete" : "on_edit";
  return { ...base, type: "command-gate", command, trigger };
}

async function buildCommandForbidRule(
  rl: readline.Interface,
  base: Pick<Rule, "id" | "description" | "blocking">
): Promise<import("../types.js").CommandForbidRule> {
  const pattern = await ask(rl, "Forbidden shell command regex (e.g. rm\\s+-rf|sudo|push\\s+--force)");
  const flags   = await ask(rl, "Regex flags", "i");
  return { ...base, type: "command-forbid", pattern, ...(flags ? { flags } : {}) };
}

async function buildPathProtectRule(
  rl: readline.Interface,
  base: Pick<Rule, "id" | "description" | "blocking">
): Promise<import("../types.js").PathProtectRule> {
  const pathsStr = await ask(rl, "Protected file paths/globs (comma-separated, e.g. .env,.git/**,package-lock.json)", ".env");
  const paths = pathsStr.split(",").map((s) => s.trim()).filter(Boolean);
  return { ...base, type: "path-protect", paths };
}

// ── Main wizard ────────────────────────────────────────────────────────────

export async function runRuleWizard(
  rl: readline.Interface,
  cwd: string
): Promise<Rule | null> {
  console.log();
  console.log(chalk.hex("#C0392B").bold("  ── Add New Rule ─────────────────────────────────"));
  console.log();

  // 1. scope
  const scopeIdx = await choose(rl, "Where should this rule be saved?", [
    `workspace  ${chalk.dim(`(.rules.yaml in ${cwd})`)}`,
    `global     ${chalk.dim("(~/.ironclad/rules.yaml — applies to all projects)")}`,
  ]);
  const scope: Scope      = scopeIdx === 0 ? "workspace" : "global";
  const filePath           = scope === "workspace" ? workspaceRules(cwd) : GLOBAL_RULES;

  // 2. type
  const typeIdx = await choose(rl, "Rule type:", [
    `diff-scope       ${chalk.dim("— restrict which files the agent can edit")}`,
    `pattern-forbid   ${chalk.dim("— block edits that add a forbidden pattern")}`,
    `pattern-require  ${chalk.dim("— require added code to include a pattern")}`,
    `command-gate     ${chalk.dim("— gate task completion on a command (tests, lint…)")}`,
    `command-forbid   ${chalk.dim("— block dangerous shell commands (rm -rf, sudo, force push)")}`,
    `path-protect     ${chalk.dim("— lock sensitive files from any modifications (.env, etc.)")}`,
  ]);
  const types = ["diff-scope", "pattern-forbid", "pattern-require", "command-gate", "command-forbid", "path-protect"] as const;
  const type = types[typeIdx];

  // 3. shared fields
  const description = await ask(rl, "Short description (human-readable)", "");
  const defaultId   = description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/, "") || type;
  const id          = await ask(rl, "Rule ID (slug)", defaultId);
  const blockingStr = await ask(rl, "Blocking? yes = reject action, no = warn only", "yes");
  const blocking    = !blockingStr.toLowerCase().startsWith("n");
  const base        = { id, description: description || undefined, blocking };

  // 4. type-specific fields
  let rule: Rule;
  if (type === "diff-scope")        rule = await buildDiffScopeRule(rl, base);
  else if (type === "pattern-forbid") rule = await buildPatternForbidRule(rl, base);
  else if (type === "pattern-require") rule = await buildPatternRequireRule(rl, base);
  else if (type === "command-gate")    rule = await buildCommandGateRule(rl, base);
  else if (type === "command-forbid")  rule = await buildCommandForbidRule(rl, base);
  else                                rule = await buildPathProtectRule(rl, base);

  // 5. preview
  console.log();
  console.log(chalk.hex("#C0392B")("  ── Preview ─────────────────────────────────────────"));
  const preview = yaml.dump({ rules: [rule] })
    .split("\n")
    .map((l) => "  " + chalk.dim(l))
    .join("\n");
  console.log(preview);

  const confirm = await ask(rl, `Save to ${scope} rules? (yes/no)`, "yes");
  if (!confirm.toLowerCase().startsWith("y")) {
    console.log(chalk.dim("  Cancelled.\n"));
    return null;
  }

  appendRule(filePath, rule);
  console.log(chalk.green(`  ✔  Rule "${id}" saved → ${filePath}\n`));
  return rule;
}
