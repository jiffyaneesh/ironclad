/**
 * Core types for the rule-enforcement engine.
 *
 * The central idea: rules are structured, mechanically-checkable objects —
 * never prose fed into a prompt. The model never "reads" a rule and decides
 * whether to comply. Every proposed action is checked against the compiled
 * rule set before it is allowed to execute.
 */

// ---- Rules -----------------------------------------------------------

export type RuleType =
  | "diff-scope" // restrict which files/paths may be touched
  | "pattern-forbid" // reject content matching a forbidden pattern
  | "pattern-require" // require content to match a pattern (e.g. error handling present)
  | "command-gate" // an external command must exit 0 before an action/task is accepted
  | "command-forbid" // block execution of shell commands matching a forbidden regex/pattern
  | "path-protect"; // forbid editing or deleting specified sensitive file paths/globs

export interface BaseRule {
  id: string;
  type: RuleType;
  description?: string;
  /** glob pattern(s) this rule applies to, e.g. "src/**\/*.ts" */
  applies_to?: string | string[];
  /** if true, a violation blocks the action; if false, it's a warning only */
  blocking?: boolean; // default true
  /**
   * Controls how the retry budget is counted for this rule.
   * "global"   — one shared counter across the whole run (default, matches MVP behaviour)
   * "per-file" — a separate counter per file path; prevents a rule that legitimately
   *              needs multiple attempts on N different files from tripping the same counter
   */
  retry_budget_scope?: "global" | "per-file";
}

export interface DiffScopeRule extends BaseRule {
  type: "diff-scope";
  /**
   * "declared" = only files explicitly named in the task/plan may be modified.
   * "glob" = only files matching applies_to may be modified at all.
   */
  mode: "declared" | "glob";
}

export interface PatternForbidRule extends BaseRule {
  type: "pattern-forbid";
  pattern: string; // regex, applied to added/changed lines only
  flags?: string;
}

export interface PatternRequireRule extends BaseRule {
  type: "pattern-require";
  pattern: string;
  flags?: string;
  /** only enforce when the changed content matches this trigger pattern
   *  e.g. require try/catch only in files that added a fetch() call */
  trigger_pattern?: string;
}

export interface CommandGateRule extends BaseRule {
  type: "command-gate";
  command: string;
  /** when this gate is checked: after every file edit, or only when the
   *  agent claims the task is complete */
  trigger: "on_edit" | "on_task_complete";
  timeout_ms?: number;
}

export interface CommandForbidRule extends BaseRule {
  type: "command-forbid";
  pattern: string; // regex tested against proposed shell command string
  flags?: string;
}

export interface PathProtectRule extends BaseRule {
  type: "path-protect";
  /** List of globs or exact filenames that can never be modified (e.g. [".env", ".git/**", "package-lock.json"]) */
  paths: string[];
}

export type Rule =
  | DiffScopeRule
  | PatternForbidRule
  | PatternRequireRule
  | CommandGateRule
  | CommandForbidRule
  | PathProtectRule;

export interface RuleFile {
  rules: Rule[];
}

// ---- Proposed actions --------------------------------------------------

export interface EditFileAction {
  kind: "edit_file";
  path: string;
  /** full new content of the file (MVP: whole-file replace, not a patch) */
  content: string;
  /** previous content, if the file existed — used to compute added lines */
  previousContent?: string;
}

export interface RunCommandAction {
  kind: "run_command";
  command: string;
}

export interface TaskCompleteAction {
  kind: "task_complete";
  summary: string;
}

export type ProposedAction = EditFileAction | RunCommandAction | TaskCompleteAction;

// ---- Check results ------------------------------------------------------

export interface RuleViolation {
  ruleId: string;
  message: string;
  blocking: boolean;
  /** Set for edit_file violations so the engine can scope retry budgets per file. */
  filePath?: string;
}

export interface CheckResult {
  ok: boolean;
  violations: RuleViolation[];
}

// ---- Task context ---------------------------------------------------------

export interface TaskContext {
  description: string;
  /** files the model declared it intends to touch, set at task start */
  declaredFiles: string[];
}
