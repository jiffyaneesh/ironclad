import { minimatch } from "minimatch";
import type {
  CommandForbidRule,
  PathProtectRule,
  EditFileAction,
  RunCommandAction,
  RuleViolation,
} from "../types.js";

/**
 * Pure checker function for command-forbid rules.
 * Intercepts destructive shell commands before they execute.
 */
export function checkCommandForbid(
  rule: CommandForbidRule,
  action: RunCommandAction
): RuleViolation | null {
  const regex = new RegExp(rule.pattern, rule.flags ?? "i");
  if (regex.test(action.command)) {
    return {
      ruleId: rule.id,
      blocking: rule.blocking ?? true,
      message: `command "${action.command}" matched forbidden command pattern /${rule.pattern}/`,
    };
  }
  return null;
}

/**
 * Pure checker function for path-protect rules.
 * Prevents modifications to sensitive files (e.g. .env, .git/**, lockfiles).
 */
export function checkPathProtect(
  rule: PathProtectRule,
  action: EditFileAction
): RuleViolation | null {
  const normalizedPath = action.path.replace(/^\.\//, "");
  const matches = rule.paths.some(
    (pattern) =>
      normalizedPath === pattern ||
      minimatch(normalizedPath, pattern, { dot: true })
  );

  if (matches) {
    return {
      ruleId: rule.id,
      blocking: rule.blocking ?? true,
      filePath: action.path,
      message: `edit touches protected path "${action.path}", which is locked by rule [${rule.id}]`,
    };
  }
  return null;
}
