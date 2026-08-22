import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Rule, RuleFile } from "./types.js";

const VALID_TYPES = new Set(["diff-scope", "pattern-forbid", "pattern-require", "command-gate"]);

export function loadRules(path: string): Rule[] {
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw) as RuleFile;

  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error(`${path}: expected a top-level "rules" list`);
  }

  for (const rule of parsed.rules) {
    if (!rule.id) throw new Error(`Rule missing "id": ${JSON.stringify(rule)}`);
    if (!VALID_TYPES.has(rule.type)) {
      throw new Error(`Rule "${rule.id}" has unknown type "${rule.type}"`);
    }
    if (rule.blocking === undefined) rule.blocking = true;
  }

  return parsed.rules;
}
