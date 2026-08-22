import { minimatch } from "minimatch";
import { diffLines } from "diff";
import type {
  EditFileAction,
  PatternForbidRule,
  PatternRequireRule,
  RuleViolation,
} from "../types.js";

/**
 * Returns lines that were genuinely added in this edit, using a real line-level
 * unified diff. Avoids false positives from the previous set-comparison approach,
 * which treated reordered identical lines as "added".
 *
 * Both inputs are normalized to end with "\n" so diffLines computes a clean
 * line-level diff — without this, a missing trailing newline causes the entire
 * file to be treated as a single replacement instead of per-line changes.
 */
function addedLines(action: EditFileAction): string[] {
  const normalize = (s: string) => (s.endsWith("\n") ? s : s + "\n");
  const before = normalize(action.previousContent ?? "");
  const changes = diffLines(before, normalize(action.content));
  return changes
    .filter((c) => c.added)
    .flatMap((c) => c.value.split("\n").filter((l) => l.length > 0));
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
