import { describe, it, expect } from "vitest";
import { checkDiffScope } from "../diffScope.js";
import type { DiffScopeRule, EditFileAction, TaskContext } from "../../types.js";

// ---- helpers ----------------------------------------------------------------

function editAction(path: string): EditFileAction {
  return { kind: "edit_file", path, content: "const x = 1;" };
}

function ctx(declaredFiles: string[]): TaskContext {
  return { description: "test task", declaredFiles };
}

// ---- declared mode ----------------------------------------------------------

describe("checkDiffScope — declared mode", () => {
  const rule: DiffScopeRule = {
    id: "stay-in-scope",
    type: "diff-scope",
    mode: "declared",
    blocking: true,
  };

  it("returns null when the file is in the declared scope", () => {
    const result = checkDiffScope(rule, editAction("src/auth.ts"), ctx(["src/auth.ts"]));
    expect(result).toBeNull();
  });

  it("returns a violation when the file is NOT in declared scope", () => {
    const result = checkDiffScope(
      rule,
      editAction("src/unrelated.ts"),
      ctx(["src/auth.ts"])
    );
    expect(result).not.toBeNull();
    expect(result?.ruleId).toBe("stay-in-scope");
    expect(result?.blocking).toBe(true);
    expect(result?.message).toContain("src/unrelated.ts");
    expect(result?.message).toContain("src/auth.ts");
  });

  it("returns null when declared scope is empty (no restriction applied)", () => {
    // With no declared files, declared mode does not block anything —
    // the engine shouldn't block an agent that hasn't been given a scope.
    const result = checkDiffScope(rule, editAction("src/anything.ts"), ctx([]));
    expect(result).toBeNull();
  });

  it("allows edits to any file in the declared list", () => {
    const declared = ["src/a.ts", "src/b.ts", "src/c.ts"];
    for (const file of declared) {
      expect(checkDiffScope(rule, editAction(file), ctx(declared))).toBeNull();
    }
  });
});

// ---- glob mode --------------------------------------------------------------

describe("checkDiffScope — glob mode", () => {
  const rule: DiffScopeRule = {
    id: "src-only",
    type: "diff-scope",
    mode: "glob",
    applies_to: "src/**/*.ts",
    blocking: true,
  };

  it("returns null when the edited file matches the glob", () => {
    const result = checkDiffScope(rule, editAction("src/utils/helpers.ts"), ctx([]));
    expect(result).toBeNull();
  });

  it("returns a violation when the file does not match the glob", () => {
    const result = checkDiffScope(rule, editAction("scripts/build.js"), ctx([]));
    expect(result).not.toBeNull();
    expect(result?.message).toContain("scripts/build.js");
  });

  it("returns null when applies_to is not set (no restriction)", () => {
    const openRule: DiffScopeRule = {
      id: "open",
      type: "diff-scope",
      mode: "glob",
      blocking: true,
    };
    expect(checkDiffScope(openRule, editAction("any/file.ts"), ctx([]))).toBeNull();
  });

  it("supports multiple glob patterns via array", () => {
    const multiRule: DiffScopeRule = {
      id: "multi-glob",
      type: "diff-scope",
      mode: "glob",
      applies_to: ["src/**/*.ts", "lib/**/*.ts"],
      blocking: true,
    };
    expect(checkDiffScope(multiRule, editAction("src/a.ts"), ctx([]))).toBeNull();
    expect(checkDiffScope(multiRule, editAction("lib/b.ts"), ctx([]))).toBeNull();
    expect(checkDiffScope(multiRule, editAction("scripts/c.js"), ctx([]))).not.toBeNull();
  });
});
