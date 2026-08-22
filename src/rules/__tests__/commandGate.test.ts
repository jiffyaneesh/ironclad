import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommandGateRule } from "../../types.js";

// Mock node:child_process before importing the module under test
// so we don't actually execute shell commands in tests.
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Import after mock is set up
const { checkCommandGate } = await import("../commandGate.js");
const { execSync } = await import("node:child_process");
const mockedExecSync = vi.mocked(execSync);

// ---- helpers ----------------------------------------------------------------

const baseRule: CommandGateRule = {
  id: "tests-must-pass",
  type: "command-gate",
  command: "npm test",
  trigger: "on_task_complete",
  timeout_ms: 5000,
  blocking: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- tests ------------------------------------------------------------------

describe("checkCommandGate", () => {
  it("returns null when the command exits 0", () => {
    mockedExecSync.mockReturnValue(Buffer.from("ok"));
    const result = checkCommandGate(baseRule, "/repo");
    expect(result).toBeNull();
    expect(mockedExecSync).toHaveBeenCalledWith("npm test", {
      cwd: "/repo",
      stdio: "pipe",
      timeout: 5000,
    });
  });

  it("returns a blocking violation when the command fails", () => {
    const error = Object.assign(new Error("exit 1"), {
      status: 1,
      stdout: Buffer.from("FAIL src/auth.test.ts\n"),
      stderr: Buffer.from(""),
    });
    mockedExecSync.mockImplementation(() => { throw error; });

    const result = checkCommandGate(baseRule, "/repo");
    expect(result).not.toBeNull();
    expect(result?.ruleId).toBe("tests-must-pass");
    expect(result?.blocking).toBe(true);
    expect(result?.message).toContain("npm test");
    expect(result?.message).toContain("FAIL");
  });

  it("uses the rule's timeout_ms when calling execSync", () => {
    mockedExecSync.mockReturnValue(Buffer.from(""));
    checkCommandGate({ ...baseRule, timeout_ms: 30_000 }, "/repo");
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 30_000 })
    );
  });

  it("falls back to 120s default timeout when timeout_ms is not set", () => {
    mockedExecSync.mockReturnValue(Buffer.from(""));
    const noTimeout: CommandGateRule = { ...baseRule, timeout_ms: undefined };
    checkCommandGate(noTimeout, "/repo");
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 120_000 })
    );
  });

  it("includes truncated command output in the violation message", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const error = Object.assign(new Error("exit 1"), {
      status: 1,
      stdout: Buffer.from(lines),
      stderr: Buffer.from(""),
    });
    mockedExecSync.mockImplementation(() => { throw error; });

    const result = checkCommandGate(baseRule, "/repo");
    // commandGate shows last ~15 lines — should not include very early lines
    expect(result?.message).not.toContain("line 0");
    expect(result?.message).toContain("line 29");
  });

  it("returns a non-blocking violation when blocking is false", () => {
    const error = Object.assign(new Error("exit 1"), { status: 1 });
    mockedExecSync.mockImplementation(() => { throw error; });

    const result = checkCommandGate({ ...baseRule, blocking: false }, "/repo");
    expect(result?.blocking).toBe(false);
  });
});
