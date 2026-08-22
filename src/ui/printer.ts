import chalk from "chalk";
import type { Rule, RuleViolation } from "../types.js";

export function clearScreen() {
  // Clear terminal screen and scrollback buffer
  process.stdout.write("\x1Bc");
}

export function printBanner(provider: string, model: string, cwd: string, rulesCount: number) {
  const shortCwd = cwd.replace(/^\/home\/[^/]+/, "~");

  console.log();
  console.log(chalk.bold.hex("#E5A05B")("  ╭────────────────────────────────────────────────────────╮"));
  console.log(
    chalk.bold.hex("#E5A05B")("  │") +
      chalk.bold.white("  ⚡ IRONCLAD ") +
      chalk.dim("— Mechanically-Gated AI Coding Agent       ") +
      chalk.bold.hex("#E5A05B")("│")
  );
  console.log(chalk.bold.hex("#E5A05B")("  ├────────────────────────────────────────────────────────┤"));
  console.log(
    chalk.bold.hex("#E5A05B")("  │") +
      `  ${chalk.bold("Model:")}     ${chalk.cyan(provider)} ${chalk.dim("/")} ${chalk.bold.green(model)}`.padEnd(65) +
      chalk.bold.hex("#E5A05B")("│")
  );
  console.log(
    chalk.bold.hex("#E5A05B")("  │") +
      `  ${chalk.bold("Rules:")}     ${chalk.yellow(`${rulesCount} rules active`)}`.padEnd(65) +
      chalk.bold.hex("#E5A05B")("│")
  );
  console.log(
    chalk.bold.hex("#E5A05B")("  │") +
      `  ${chalk.bold("Directory:")} ${chalk.dim(shortCwd)}`.padEnd(65) +
      chalk.bold.hex("#E5A05B")("│")
  );
  console.log(chalk.bold.hex("#E5A05B")("  ├────────────────────────────────────────────────────────┤"));
  console.log(
    chalk.bold.hex("#E5A05B")("  │") +
      chalk.dim("  Commands: /rules (inspect)  /scope (restrict)  /exit     ") +
      chalk.bold.hex("#E5A05B")("│")
  );
  console.log(chalk.bold.hex("#E5A05B")("  ╰────────────────────────────────────────────────────────╯"));
  console.log();
}

export function printRules(rules: Rule[]) {
  console.log(chalk.bold.hex("#E5A05B")("\n  Active Rule Guardrails:"));
  if (rules.length === 0) {
    console.log(chalk.dim("    (No custom rules loaded from .rules.yaml)"));
    return;
  }
  for (const rule of rules) {
    const badge = rule.blocking ? chalk.bgRed.black.bold(" BLOCK ") : chalk.bgYellow.black.bold(" WARN  ");
    const desc = rule.description ? chalk.dim(` — ${rule.description}`) : "";
    console.log(`    ${badge} ${chalk.bold.white(rule.id)} ${chalk.dim(`[${rule.type}]`)}${desc}`);
  }
  console.log();
}

export function printAssistantMessage(text: string) {
  console.log(`\n${chalk.bold.hex("#E5A05B")("●")} ${chalk.bold.white("Claude / Assistant")}`);
  console.log(chalk.white(indentText(text.trim(), "  ")));
  console.log();
}

export function printToolCall(toolName: string, input: Record<string, unknown>) {
  const summary = formatToolInput(toolName, input);
  console.log(`  ${chalk.cyan("⏺")} ${chalk.bold.cyan(toolName)} ${chalk.dim(summary)}`);
}

export function printToolApplied(detail: string) {
  console.log(`    ${chalk.green("✔")} ${chalk.dim(detail)}`);
}

export function printToolRejected(violations: RuleViolation[]) {
  for (const v of violations) {
    const badge = v.blocking ? chalk.red.bold("⛔ REJECTED") : chalk.yellow.bold("⚠ WARNING");
    console.log(`    ${badge} ${chalk.bold.red(`[${v.ruleId}]`)} ${chalk.white(v.message)}`);
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
      `Rule "${ruleId}" exceeded its retry budget. Stopping execution to prevent infinite hallucination.`
    )
  );
  console.log();
}

function indentText(str: string, prefix: string): string {
  return str
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
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
