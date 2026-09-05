import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendAuditEvent, auditLogPath, type AuditEvent } from "../index.js";
import { readAuditLog, summariseAuditLog } from "../reader.js";

function makeTmpRepo(): string {
  const dir = join(tmpdir(), `ironclad-audit-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    severity: "BLOCKED",
    ruleId: "no-console",
    message: "console.log is forbidden",
    toolName: "edit_file",
    ...overrides,
  };
}

describe("audit", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpRepo();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns empty array when no log exists", () => {
    expect(readAuditLog(cwd)).toEqual([]);
  });

  it("appends events and reads them back newest-first", () => {
    const e1 = makeEvent({ ruleId: "rule-a", message: "first" });
    const e2 = makeEvent({ ruleId: "rule-b", message: "second" });
    appendAuditEvent(cwd, e1);
    appendAuditEvent(cwd, e2);

    const events = readAuditLog(cwd);
    // newest-first: e2 was appended last, so it should appear at index 0
    expect(events).toHaveLength(2);
    expect(events[0].ruleId).toBe("rule-b");
    expect(events[1].ruleId).toBe("rule-a");
  });

  it("skips malformed lines without crashing", () => {
    const logPath = auditLogPath(cwd);
    mkdirSync(join(cwd, ".ironclad"), { recursive: true });
    const { appendFileSync } = require("node:fs");
    appendFileSync(logPath, "not-valid-json\n");
    appendFileSync(logPath, JSON.stringify(makeEvent()) + "\n");

    const events = readAuditLog(cwd);
    expect(events).toHaveLength(1); // only the valid line parsed
  });

  it("summarises violations grouped by ruleId", () => {
    appendAuditEvent(cwd, makeEvent({ ruleId: "rule-x", severity: "BLOCKED" }));
    appendAuditEvent(cwd, makeEvent({ ruleId: "rule-x", severity: "BLOCKED" }));
    appendAuditEvent(cwd, makeEvent({ ruleId: "rule-y", severity: "WARNING" }));

    const events = readAuditLog(cwd);
    const summary = summariseAuditLog(events);

    const rx = summary.find((s) => s.ruleId === "rule-x");
    const ry = summary.find((s) => s.ruleId === "rule-y");

    expect(rx?.blocked).toBe(2);
    expect(rx?.warned).toBe(0);
    expect(ry?.blocked).toBe(0);
    expect(ry?.warned).toBe(1);
    // rule-x has 2 total, rule-y has 1 — rule-x should sort first
    expect(summary[0].ruleId).toBe("rule-x");
  });
});
