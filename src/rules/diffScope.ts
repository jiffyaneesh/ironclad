import { minimatch } from "minimatch";
import type { DiffScopeRule, EditFileAction, RuleViolation, TaskContext } from "../types.js";

export function checkDiffScope(
  rule: DiffScopeRule,
  action: EditFileAction,
  ctx: TaskContext
): RuleViolation | null {
  if (rule.mode === "declared") {
    const declared = ctx.declaredFiles;
    if (declared.length > 0 && !declared.includes(action.path)) {
      return {
        ruleId: rule.id,
        blocking: rule.blocking ?? true,
        message:
          `edit touches "${action.path}", which was not in the declared scope for this task ` +
          `(declared: ${declared.join(", ")}). If this file genuinely needs to change, ` +
          `state why and re-declare scope before editing it.`,
      };
    }
    return null;
  }

  // mode === "glob": file must match applies_to to be editable at all
  const patterns = normalizeGlobs(rule.applies_to);
  if (patterns.length === 0) return null;

  const matches = patterns.some((p) => minimatch(action.path, p));
  if (!matches) {
    return {
      ruleId: rule.id,
      blocking: rule.blocking ?? true,
      message: `edit touches "${action.path}", which is outside the allowed scope (${patterns.join(", ")}).`,
    };
  }
  return null;
}

function normalizeGlobs(applies_to: string | string[] | undefined): string[] {
  if (!applies_to) return [];
  return Array.isArray(applies_to) ? applies_to : [applies_to];
}
