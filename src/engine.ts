import type { CheckResult, ProposedAction, Rule, RuleViolation, TaskContext } from "./types.js";
import { checkDiffScope } from "./rules/diffScope.js";
import { checkPatternForbid, checkPatternRequire } from "./rules/pattern.js";
import { checkCommandGate } from "./rules/commandGate.js";

export interface RuleFailureRecord {
  ruleId: string;
  count: number;
}

/**
 * The engine sits between "model wants to do X" and "X actually happens."
 * Nothing the model proposes reaches the filesystem or the shell until it
 * clears every applicable rule. This is the mechanism that makes rules
 * unable to degrade with context size — they're not being "remembered" by
 * anyone, they're being executed.
 */
export class RuleEngine {
  private failureCounts = new Map<string, number>();
  private readonly retryBudget: number;

  constructor(
    private rules: Rule[],
    private cwd: string,
    opts: { retryBudget?: number } = {}
  ) {
    this.retryBudget = opts.retryBudget ?? 3;
  }

  /** Check a proposed action. Does NOT execute it — call `.apply` separately
   *  once this returns ok. */
  check(action: ProposedAction, ctx: TaskContext): CheckResult {
    const violations: RuleViolation[] = [];

    if (action.kind === "edit_file") {
      for (const rule of this.rules) {
        if (rule.type === "diff-scope") {
          const v = checkDiffScope(rule, action, ctx);
          if (v) violations.push(v);
        } else if (rule.type === "pattern-forbid") {
          const v = checkPatternForbid(rule, action);
          if (v) violations.push(v);
        } else if (rule.type === "pattern-require") {
          const v = checkPatternRequire(rule, action);
          if (v) violations.push(v);
        }
      }
    }

    if (action.kind === "task_complete") {
      for (const rule of this.rules) {
        if (rule.type === "command-gate" && rule.trigger === "on_task_complete") {
          const v = checkCommandGate(rule, this.cwd);
          if (v) violations.push(v);
        }
      }
    }

    const blockingViolations = violations.filter((v) => v.blocking);
    for (const v of blockingViolations) {
      this.failureCounts.set(v.ruleId, (this.failureCounts.get(v.ruleId) ?? 0) + 1);
    }

    return { ok: blockingViolations.length === 0, violations };
  }

  /** Has any single rule been violated past the retry budget? Used to force
   *  escalation instead of letting the agent loop forever against the same
   *  wall. */
  exceededBudget(): RuleFailureRecord | null {
    for (const [ruleId, count] of this.failureCounts.entries()) {
      if (count > this.retryBudget) return { ruleId, count };
    }
    return null;
  }

  reset() {
    this.failureCounts.clear();
  }
}
