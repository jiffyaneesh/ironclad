import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import yaml from "js-yaml";
import type { Rule, RuleFile } from "../types.js";

export function loadRulesFile(path: string): Rule[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = yaml.load(readFileSync(path, "utf-8")) as RuleFile;
    return Array.isArray(parsed?.rules) ? parsed.rules : [];
  } catch {
    return [];
  }
}

/** Appends a single rule to a YAML rules file, creating it if needed. */
export function appendRule(path: string, rule: Rule): void {
  const existing = loadRulesFile(path);
  existing.push(rule);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, yaml.dump({ rules: existing }), "utf-8");
}

/** Merge global rules (applied first) + workspace rules (applied last, higher priority). */
export function mergeRules(globalRules: Rule[], workspaceRules: Rule[]): Rule[] {
  return [...globalRules, ...workspaceRules];
}
