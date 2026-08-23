import type { CheckResult, ProposedAction, Rule, RuleViolation, TaskContext } from "./types.js";
import { checkDiffScope } from "./rules/diffScope.js";
import { checkPatternForbid, checkPatternRequire } from "./rules/pattern.js";
import { checkCommandGate } from "./rules/commandGate.js";
import { checkCommandForbid, checkPathProtect } from "./rules/guard.js";

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
  /**
   * Failure counters keyed as either `"ruleId"` (global scope) or
   * `"ruleId::filePath"` (per-file scope). The engine inspects each rule's
   * `retry_budget_scope` field to decide which key to use.
   */
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
        let v: RuleViolation | null = null;
        if (rule.type === "diff-scope") {
          v = checkDiffScope(rule, action, ctx);
        } else if (rule.type === "pattern-forbid") {
          v = checkPatternForbid(rule, action);
        } else if (rule.type === "pattern-require") {
          v = checkPatternRequire(rule, action);
        } else if (rule.type === "path-protect") {
          v = checkPathProtect(rule, action);
        }
        if (v) violations.push({ ...v, filePath: action.path });
      }
    }

    if (action.kind === "run_command") {
      for (const rule of this.rules) {
        if (rule.type === "command-forbid") {
          const v = checkCommandForbid(rule, action);
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
      const rule = this.rules.find((r) => r.id === v.ruleId);
      const isPerFile = rule?.retry_budget_scope === "per-file";
      const key = isPerFile && v.filePath ? `${v.ruleId}::${v.filePath}` : v.ruleId;
      this.failureCounts.set(key, (this.failureCounts.get(key) ?? 0) + 1);
    }

    return { ok: blockingViolations.length === 0, violations };
  }

  /** Has any single rule (or rule+file pair for per-file scope) been violated
   *  past the retry budget? Used to force escalation instead of letting the
   *  agent loop forever against the same wall. */
  exceededBudget(): RuleFailureRecord | null {
    for (const [key, count] of this.failureCounts.entries()) {
      if (count > this.retryBudget) {
        // Extract the ruleId from either "ruleId" or "ruleId::filePath" keys
        const ruleId = key.includes("::") ? key.split("::")[0] : key;
        return { ruleId, count };
      }
    }
    return null;
  }

  reset() {
    this.failureCounts.clear();
  }
}
