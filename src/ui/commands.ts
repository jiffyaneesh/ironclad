import { execSync } from "node:child_process";
import chalk from "chalk";
import type { Rule } from "../types.js";
import { RuleEngine } from "../engine.js";
import { createLLMClient, type Provider, type ResolvedLLMClient } from "../llm/index.js";

export function handleCommitCommand(
  cwd: string,
  rules: Rule[],
  customMessage?: string
): void {
  console.log(chalk.hex("#E74C3C").bold("\n  ⚡ Pre-Commit Rule Verification"));

  // Check git status
  let statusOut = "";
  try {
    statusOut = execSync("git status --short", { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    console.log(chalk.red("  ✖ Not a git repository or git not found.\n"));
    return;
  }

  if (!statusOut) {
    console.log(chalk.dim("  No changes to commit. Working tree clean.\n"));
    return;
  }

  console.log(chalk.dim("  Files changed:\n" + statusOut.split("\n").map((l) => "    " + l).join("\n")));

  // Run on_task_complete command-gates (tests, typecheck, lint) before allowing commit
  const engine = new RuleEngine(rules, cwd);
  const check = engine.check({ kind: "task_complete", summary: "Pre-commit verification" }, { description: "commit", declaredFiles: [] });

  if (!check.ok) {
    console.log(chalk.bgHex("#C0392B").white.bold("\n  ⛔ COMMIT BLOCKED BY RULE GATE "));
    check.violations.forEach((v) => {
      console.log(chalk.red(`  • [${v.ruleId}] ${v.message}`));
    });
    console.log(chalk.dim("\n  Fix the failing checks before committing.\n"));
    return;
  }

  // Stage and commit
  try {
    execSync("git add -A", { cwd, stdio: "pipe" });
    const commitMsg = customMessage || generateFallbackCommitMsg(statusOut);
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd, stdio: "pipe" });
    console.log(chalk.green(`\n  ✔ Committed changes: "${commitMsg}"\n`));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`  ✖ Commit failed: ${msg}\n`));
  }
}

export function handleReviewCommand(cwd: string, rules: Rule[]): void {
  console.log(chalk.hex("#E74C3C").bold("\n  🔍 Code Review & Rule Audit"));

  let diff = "";
  try {
    diff = execSync("git diff HEAD", { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    console.log(chalk.red("  ✖ Unable to read git diff.\n"));
    return;
  }

  if (!diff) {
    console.log(chalk.dim("  No uncommitted diff found to review.\n"));
    return;
  }

  const lines = diff.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const deleted = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  console.log(chalk.dim(`  Diff stats: ${chalk.green(`+${added}`)} ${chalk.red(`-${deleted}`)} lines`));

  // Run rule checkers against uncommitted changes
  const engine = new RuleEngine(rules, cwd);
  const taskCheck = engine.check({ kind: "task_complete", summary: "Review check" }, { description: "review", declaredFiles: [] });

  console.log();
  if (taskCheck.violations.length === 0) {
    console.log(chalk.green("  ✔ All active command gates & rules are passing."));
  } else {
    taskCheck.violations.forEach((v) => {
      const badge = v.blocking ? chalk.bgHex("#C0392B").bold(" BLOCK ") : chalk.bgYellow.black.bold(" WARN ");
      console.log(`  ${badge} ${chalk.hex("#FF6B6B")(v.ruleId)}: ${chalk.dim(v.message)}`);
    });
  }
  console.log();
}

export function handleUndoCommand(cwd: string): void {
  console.log(chalk.hex("#E74C3C").bold("\n  ↺ Revert Uncommitted Changes"));
  try {
    execSync("git checkout -- .", { cwd, stdio: "pipe" });
    console.log(chalk.green("  ✔ Working directory changes reverted to HEAD.\n"));
  } catch (err: unknown) {
    console.log(chalk.red("  ✖ Revert failed (make sure this is a git repo).\n"));
  }
}

export function handleModelSwitch(
  modelArg: string,
  current: ResolvedLLMClient
): ResolvedLLMClient {
  const trimmed = modelArg.trim();
  if (!trimmed) {
    console.log(chalk.dim(`\n  Current model: ${current.provider} / ${current.model}\n  Usage: /model <gemini|anthropic|openai> [model-name]\n`));
    return current;
  }

  const parts = trimmed.split(/\s+/);
  const provider = parts[0] as Provider;
  const modelOverride = parts[1];

  try {
    const updated = createLLMClient({ provider, model: modelOverride });
    console.log(chalk.green(`\n  ✔ Switched to ${updated.provider} (${updated.model})\n`));
    return updated;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n  ✖ Failed to switch model: ${msg}\n`));
    return current;
  }
}

function generateFallbackCommitMsg(status: string): string {
  const files = status.split("\n").map((l) => l.trim().slice(3));
  if (files.length === 1) {
    return `chore: update ${files[0]}`;
  }
  return `chore: update ${files.length} files`;
}
