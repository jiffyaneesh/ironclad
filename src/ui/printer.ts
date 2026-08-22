import chalk from "chalk";
import type { Rule, RuleViolation } from "../types.js";

export function printBanner(provider: string, model: string, cwd: string, rulesCount: number) {
  console.log();
  console.log(chalk.bold.cyan("  ⚙  IRONCLAD AI HARNESS"));
  console.log(chalk.dim("  ────────────────────────────────────────────────"));
  console.log(`  ${chalk.bold("Model:")}    ${chalk.green(provider)} / ${chalk.yellow(model)}`);
  console.log(`  ${chalk.bold("Rules:")}    ${chalk.magenta(`${rulesCount} rules loaded`)}`);
  console.log(`  ${chalk.bold("Scope:")}    ${chalk.blue(cwd)}`);
  console.log(chalk.dim("  ────────────────────────────────────────────────"));
  console.log(chalk.dim("  Type your prompt to start working, or commands:"));
  console.log(`  ${chalk.yellow("/rules")}  list active rules     ${chalk.yellow("/scope")}  set declared file scope`);
  console.log(`  ${chalk.yellow("/clear")}  clear conversation     ${chalk.yellow("/exit")}   quit`);
  console.log();
}

export function printRules(rules: Rule[]) {
  console.log(chalk.bold("\nActive Rules:"));
  if (rules.length === 0) {
    console.log(chalk.dim("  (No rules configured)"));
    return;
  }
  for (const rule of rules) {
    const badge = rule.blocking ? chalk.red("[BLOCKING]") : chalk.yellow("[WARN]");
    const desc = rule.description ? chalk.dim(` - ${rule.description}`) : "";
    console.log(`  • ${badge} ${chalk.cyan(rule.id)} ${chalk.dim(`(${rule.type})`)}${desc}`);
  }
  console.log();
}

export function printAssistantMessage(text: string) {
  console.log(`\n${chalk.bold.green("Assistant:")}\n${text}\n`);
}

export function printToolCall(toolName: string, input: Record<string, unknown>) {
  const summary = formatToolInput(toolName, input);
  console.log(`  ${chalk.yellow("⚡")} ${chalk.bold(toolName)} ${chalk.dim(summary)}`);
}

export function printToolApplied(detail: string) {
  console.log(`    ${chalk.green("✔")} ${chalk.dim(detail)}`);
}

export function printToolRejected(violations: RuleViolation[]) {
  for (const v of violations) {
    const badge = v.blocking ? chalk.red.bold("REJECTED") : chalk.yellow.bold("WARNING");
    console.log(`    ${badge} [${chalk.cyan(v.ruleId)}] ${v.message}`);
  }
}

export function printToolError(error: string) {
  console.log(`    ${chalk.red("✖")} ${chalk.red(error)}`);
}

export function printEscalation(ruleId: string) {
  console.log();
  console.log(chalk.bgRed.white.bold(" ⚠ ESCALATION TRIGGERED "));
  console.log(
    chalk.red(
      `Rule "${ruleId}" exceeded its retry budget. Halting run to prevent agent hallucination loop.`
    )
  );
  console.log();
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "edit_file" || toolName === "read_file") {
    return String(input.path ?? "");
  }
  if (toolName === "run_command") {
    return String(input.command ?? "");
  }
  if (toolName === "list_dir") {
    return String(input.path ?? ".");
  }
  if (toolName === "task_complete") {
    return String(input.summary ?? "");
  }
  return JSON.stringify(input);
}
