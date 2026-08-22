import { execSync } from "node:child_process";
import type { CommandGateRule, RuleViolation } from "../types.js";

/**
 * Runs the gate command for real. This is the whole point: the agent cannot
 * claim "tests pass" — the harness runs the command itself and only accepts
 * the action if it actually exits 0. Output is captured so a failure message
 * can be handed back to the model as the rejection reason.
 */
export function checkCommandGate(rule: CommandGateRule, cwd: string): RuleViolation | null {
  try {
    execSync(rule.command, {
      cwd,
      stdio: "pipe",
      timeout: rule.timeout_ms ?? 120_000,
    });
    return null;
  } catch (err: any) {
    const output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
    const tail = output.trim().split("\n").slice(-15).join("\n"); // last ~15 lines is usually enough
    return {
      ruleId: rule.id,
      blocking: rule.blocking ?? true,
      message: `command "${rule.command}" failed (exit ${err.status ?? "?"}):\n${tail}`,
    };
  }
}
