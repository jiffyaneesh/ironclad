import { minimatch } from "minimatch";
import type {
  EditFileAction,
  PatternForbidRule,
  PatternRequireRule,
  RuleViolation,
} from "../types.js";

/** Returns lines present in `content` but not in `previousContent` — a cheap
 *  stand-in for "the diff" without needing a full diff library. Good enough
 *  for line-level pattern checks; swap for a real diff lib if you need
 *  precise hunk boundaries. */
function addedLines(action: EditFileAction): string[] {
  const before = new Set((action.previousContent ?? "").split("\n"));
  return action.content.split("\n").filter((line) => !before.has(line));
}

function appliesToFile(applies_to: string | string[] | undefined, path: string): boolean {
  if (!applies_to) return true;
  const patterns = Array.isArray(applies_to) ? applies_to : [applies_to];
  return patterns.some((p) => minimatch(path, p));
}

export function checkPatternForbid(
  rule: PatternForbidRule,
  action: EditFileAction
): RuleViolation | null {
  if (!appliesToFile(rule.applies_to, action.path)) return null;

  const re = new RegExp(rule.pattern, rule.flags ?? "");
  const hit = addedLines(action).find((line) => re.test(line));
  if (hit) {
    return {
      ruleId: rule.id,
      blocking: rule.blocking ?? true,
      message: `"${action.path}" adds a line matching forbidden pattern /${rule.pattern}/: "${hit.trim()}"`,
    };
  }
  return null;
}

export function checkPatternRequire(
  rule: PatternRequireRule,
  action: EditFileAction
): RuleViolation | null {
  if (!appliesToFile(rule.applies_to, action.path)) return null;

  const added = addedLines(action);
  const joined = added.join("\n");

  if (rule.trigger_pattern) {
    const trigger = new RegExp(rule.trigger_pattern, rule.flags ?? "");
    if (!trigger.test(joined)) return null; // rule not triggered by this edit
  }

  const req = new RegExp(rule.pattern, rule.flags ?? "");
  if (!req.test(joined)) {
    return {
      ruleId: rule.id,
      blocking: rule.blocking ?? true,
      message: `"${action.path}" was expected to include content matching /${rule.pattern}/ but doesn't.`,
    };
  }
  return null;
}
