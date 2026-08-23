import chalk from "chalk";
import type { Rule, RuleViolation } from "../types.js";

// ── Palette ────────────────────────────────────────────────────────────────
const R = {
  crimson: "#C0392B",
  red:     "#E74C3C",
  rose:    "#FF6B6B",
  dim:     "#7F8C8D",
  steel:   "#95A5A6",
  white:   "#ECF0F1",
  ash:     "#BDC3C7",
};

const C = {
  border:  chalk.hex(R.crimson),
  accent:  chalk.hex(R.red),
  rose:    chalk.hex(R.rose),
  dim:     chalk.hex(R.dim),
  steel:   chalk.hex(R.steel),
  white:   chalk.hex(R.white).bold,
  ash:     chalk.hex(R.ash),
};

// ── Helpers ────────────────────────────────────────────────────────────────
const W = 60; // inner width

function box(line: string): string {
  return C.border("│") + line + C.border("│");
}

function pad(str: string, width = W): string {
  // strip ANSI codes to measure real length
  const visible = str.replace(/\x1b\[[0-9;]*m/g, "");
  const spaces = Math.max(0, width - visible.length);
  return str + " ".repeat(spaces);
}

function hr(char = "─", w = W): string {
  return char.repeat(w);
}

export function clearScreen() {
  process.stdout.write("\x1Bc");
}

// ── Banner ─────────────────────────────────────────────────────────────────
export function printBanner(
  provider: string,
  model: string,
  cwd: string,
  rulesCount: number
) {
  const shortCwd = cwd.replace(/^\/home\/[^/]+/, "~");
  const version  = "v0.1.0";

  console.log();
  console.log(C.border("  ╔" + hr("═") + "╗"));
  console.log(
    C.border("  ║") +
    chalk.bgHex(R.crimson).hex(R.white).bold("  ⚡ IRONCLAD ") +
    C.ash("  Rule-Enforced AI Coding Agent  ") +
    C.dim(version.padStart(W - 47)) +
    C.border("║")
  );
  console.log(C.border("  ╠" + hr("═") + "╣"));

  // model row
  const modelLine = `  ${C.dim("model")}  ${C.steel(provider)} ${C.dim("›")} ${C.accent.bold(model)}`;
  console.log(box(pad(modelLine)));

  // rules row
  const rulesLine = `  ${C.dim("rules")}  ${rulesCount > 0 ? C.accent(`${rulesCount} active guardrails`) : C.dim("none loaded")}`;
  console.log(box(pad(rulesLine)));

  // cwd row
  const cwdLine = `  ${C.dim("cwd  ")}  ${C.steel(shortCwd)}`;
  console.log(box(pad(cwdLine)));

  console.log(C.border("  ╠" + hr("═") + "╣"));

  // commands row
  const cmds =
    `  ${C.rose("/rules")} ${C.dim("inspect")}  ` +
    `${C.rose("/scope <files>")} ${C.dim("restrict")}  ` +
    `${C.rose("/clear")} ${C.dim("reset")}  ` +
    `${C.rose("/exit")} ${C.dim("quit")}`;
  console.log(box(pad(cmds)));

  console.log(C.border("  ╚" + hr("═") + "╝"));
  console.log();
}

// ── Rules list ────────────────────────────────────────────────────────────
export function printRules(rules: Rule[]) {
  console.log();
  console.log(C.border("  ┌" + hr("─", 40) + "┐"));
  console.log(C.border("  │") + chalk.bgHex(R.crimson).bold("  Active Guardrails" + " ".repeat(22)) + C.border("│"));
  console.log(C.border("  ├" + hr("─", 40) + "┤"));

  if (rules.length === 0) {
    console.log(C.border("  │") + C.dim("  No rules loaded from .rules.yaml") + "         " + C.border("│"));
  } else {
    for (const rule of rules) {
      const badge = rule.blocking
        ? chalk.bgHex(R.crimson).bold(" BLOCK ")
        : chalk.bgYellow.black.bold(" WARN  ");
      const line = `  ${badge} ${C.white(rule.id)} ${C.dim("[" + rule.type + "]")}`;
      const desc = rule.description ? C.dim("  " + rule.description) : "";
      console.log("  " + line + desc);
    }
  }

  console.log(C.border("  └" + hr("─", 40) + "┘"));
  console.log();
}

// ── Assistant reply ───────────────────────────────────────────────────────
export function printAssistantMessage(text: string) {
  console.log();
  console.log(C.accent("  ▌ ") + C.white("Agent Response"));
  console.log(C.dim("  " + hr("─", 40)));
  const lines = text.trim().split("\n");
  for (const line of lines) {
    console.log(C.dim("  │ ") + C.ash(line));
  }
  console.log();
}

// ── Tool call ─────────────────────────────────────────────────────────────
export function printToolCall(toolName: string, input: Record<string, unknown>) {
  const icon   = toolIcon(toolName);
  const detail = formatToolInput(toolName, input);
  console.log(`  ${C.accent("▸")} ${chalk.hex(R.rose).bold(toolName)} ${icon}  ${C.steel(detail)}`);
}

export function printToolApplied(detail: string) {
  console.log(`    ${chalk.green("✔")}  ${C.dim(detail)}`);
}

export function printToolRejected(violations: RuleViolation[]) {
  for (const v of violations) {
    const badge = v.blocking
      ? chalk.bgHex(R.crimson).bold(" BLOCKED ")
      : chalk.bgYellow.black.bold(" WARNING ");
    console.log(`    ${badge}  ${chalk.hex(R.rose)("[" + v.ruleId + "]")}  ${C.ash(v.message)}`);
  }
}

export function printToolError(error: string) {
  console.log(`    ${chalk.red("✖")}  ${chalk.red(error)}`);
}

// ── Task result ───────────────────────────────────────────────────────────
export function printTaskDone(summary: string) {
  console.log();
  console.log(`  ${chalk.green("━".repeat(42))}`);
  console.log(`  ${chalk.green("✔")}  ${chalk.green.bold("Task complete")}`);
  console.log(`     ${C.ash(summary)}`);
  console.log(`  ${chalk.green("━".repeat(42))}`);
  console.log();
}

export function printEscalation(ruleId: string) {
  console.log();
  console.log(`  ${chalk.bgHex(R.crimson).bold(" ⚠  ESCALATION ")}  ${C.dim("retry budget exhausted")}`);
  console.log(`  ${C.dim("Rule")} ${chalk.hex(R.rose)(ruleId)} ${C.dim("failed too many times — stopping to avoid loops.")}`);
  console.log();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function toolIcon(name: string): string {
  const icons: Record<string, string> = {
    read_file:     "📄",
    edit_file:     "✏️ ",
    list_dir:      "📂",
    run_command:   "⚙️ ",
    task_complete: "🏁",
  };
  return icons[name] ?? "⚡";
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "edit_file" || toolName === "read_file") return String(input.path ?? "");
  if (toolName === "run_command") return String(input.command ?? "");
  if (toolName === "list_dir") return String(input.path ?? ".");
  if (toolName === "task_complete") return String(input.summary ?? "");
  return JSON.stringify(input);
}
