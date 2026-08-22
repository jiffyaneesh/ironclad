import { describe, it, expect } from "vitest";
import { checkPatternForbid, checkPatternRequire } from "../pattern.js";
import type { EditFileAction, PatternForbidRule, PatternRequireRule } from "../../types.js";

// ---- helpers ----------------------------------------------------------------

function editAction(content: string, previousContent?: string): EditFileAction {
  return { kind: "edit_file", path: "src/example.ts", content, previousContent };
}

function forbidRule(pattern: string, flags?: string): PatternForbidRule {
  return { id: "test-forbid", type: "pattern-forbid", pattern, flags, blocking: true };
}

function requireRule(pattern: string, triggerPattern?: string): PatternRequireRule {
  return {
    id: "test-require",
    type: "pattern-require",
    pattern,
    trigger_pattern: triggerPattern,
    blocking: true,
  };
}

// ---- checkPatternForbid -----------------------------------------------------

describe("checkPatternForbid", () => {
  it("returns null when no lines match the forbidden pattern", () => {
    const action = editAction("const x = 1;\nconst y = 2;");
    const result = checkPatternForbid(forbidRule("api_key\\s*="), action);
    expect(result).toBeNull();
  });

  it("returns a violation when an added line matches the forbidden pattern", () => {
    const action = editAction('const api_key = "hunter2";\nconst y = 2;');
    const result = checkPatternForbid(forbidRule("api_key\\s*="), action);
    expect(result).not.toBeNull();
    expect(result?.ruleId).toBe("test-forbid");
    expect(result?.blocking).toBe(true);
  });

  it("does NOT flag unchanged lines as added", () => {
    // Regression for the old set-comparison approach:
    // a line that exists in both old and new unchanged (same position, same content)
    // should not appear in the diff's added lines at all.
    const keepLine = "const safeVar = 1;";
    const action = editAction(
      `${keepLine}\nconst newThing = 2;`, // keepLine unchanged, newThing is added
      `${keepLine}`                         // only keepLine existed before
    );
    const result = checkPatternForbid(forbidRule("safeVar"), action);
    // keepLine was not added — it was already there. No violation.
    expect(result).toBeNull();
  });

  it("flags a line that is genuinely new (not in previous content)", () => {
    const action = editAction(
      `const existing = 1;\nconst api_key = "hunter2";`,
      `const existing = 1;`
    );
    const result = checkPatternForbid(forbidRule("api_key\\s*="), action);
    expect(result).not.toBeNull();
    expect(result?.ruleId).toBe("test-forbid");
    expect(result?.blocking).toBe(true);
  });

  it("is case-insensitive when flags include 'i'", () => {
    const action = editAction('const API_KEY = "secret123";');
    const result = checkPatternForbid(forbidRule("api_key\\s*=", "i"), action);
    expect(result).not.toBeNull();
  });

  it("skips files not matching applies_to glob", () => {
    const rule: PatternForbidRule = {
      ...forbidRule("api_key"),
      applies_to: "src/**/*.ts",
    };
    const action: EditFileAction = {
      ...editAction('const api_key = "x";'),
      path: "test/fixture.js", // does not match src/**/*.ts
    };
    expect(checkPatternForbid(rule, action)).toBeNull();
  });

  it("returns a non-blocking violation when blocking is false", () => {
    const rule: PatternForbidRule = { ...forbidRule("console\\.log"), blocking: false };
    const action = editAction("console.log('debug')");
    const result = checkPatternForbid(rule, action);
    expect(result?.blocking).toBe(false);
  });
});

// ---- checkPatternRequire ----------------------------------------------------

describe("checkPatternRequire", () => {
  it("returns null when added content satisfies the required pattern", () => {
    const action = editAction("fetch('/api').catch(handleError);");
    const result = checkPatternRequire(requireRule("catch"), action);
    expect(result).toBeNull();
  });

  it("returns a violation when required pattern is absent from added content", () => {
    const action = editAction("fetch('/api').then(doWork);");
    const result = checkPatternRequire(requireRule("catch"), action);
    expect(result).not.toBeNull();
    expect(result?.ruleId).toBe("test-require");
  });

  it("skips check when trigger_pattern is not present in added content", () => {
    // No fetch() call — the require-catch rule should not trigger at all
    const action = editAction("const x = doWork();");
    const result = checkPatternRequire(requireRule("catch", "fetch\\("), action);
    expect(result).toBeNull();
  });

  it("fires check when trigger_pattern IS present and required pattern missing", () => {
    const action = editAction("fetch('/api').then(doWork);");
    const result = checkPatternRequire(requireRule("catch", "fetch\\("), action);
    expect(result).not.toBeNull();
  });

  it("returns null when trigger fires and required pattern is present", () => {
    const action = editAction("fetch('/api').catch(err => log(err));");
    const result = checkPatternRequire(requireRule("catch", "fetch\\("), action);
    expect(result).toBeNull();
  });
});
