import { describe, it, expect } from "vitest";
import { checkCommandForbid, checkPathProtect } from "../guard.js";
import type { CommandForbidRule, PathProtectRule, RunCommandAction, EditFileAction } from "../../types.js";

describe("checkCommandForbid", () => {
  const rule: CommandForbidRule = {
    id: "no-destructive-commands",
    type: "command-forbid",
    pattern: "rm\\s+-rf|sudo|push\\s+--force",
    blocking: true,
  };

  it("blocks dangerous commands matching pattern", () => {
    const action: RunCommandAction = { kind: "run_command", command: "rm -rf /tmp/data" };
    const violation = checkCommandForbid(rule, action);
    expect(violation).not.toBeNull();
    expect(violation?.ruleId).toBe("no-destructive-commands");
    expect(violation?.blocking).toBe(true);
  });

  it("blocks sudo commands", () => {
    const action: RunCommandAction = { kind: "run_command", command: "sudo apt install something" };
    const violation = checkCommandForbid(rule, action);
    expect(violation).not.toBeNull();
  });

  it("allows safe commands", () => {
    const action: RunCommandAction = { kind: "run_command", command: "npm test" };
    const violation = checkCommandForbid(rule, action);
    expect(violation).toBeNull();
  });
});

describe("checkPathProtect", () => {
  const rule: PathProtectRule = {
    id: "protect-sensitive-files",
    type: "path-protect",
    paths: [".env", ".git/**", "package-lock.json"],
    blocking: true,
  };

  it("blocks modifications to exact protected paths", () => {
    const action: EditFileAction = { kind: "edit_file", path: ".env", content: "SECRET=1" };
    const violation = checkPathProtect(rule, action);
    expect(violation).not.toBeNull();
    expect(violation?.ruleId).toBe("protect-sensitive-files");
  });

  it("blocks modifications to protected glob patterns", () => {
    const action: EditFileAction = { kind: "edit_file", path: ".git/config", content: "foo" };
    const violation = checkPathProtect(rule, action);
    expect(violation).not.toBeNull();
  });

  it("allows modifying unprotected files", () => {
    const action: EditFileAction = { kind: "edit_file", path: "src/index.ts", content: "console.log(1);" };
    const violation = checkPathProtect(rule, action);
    expect(violation).toBeNull();
  });
});
