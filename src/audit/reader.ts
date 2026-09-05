import { readFileSync, existsSync } from "node:fs";
import type { AuditEvent } from "./index.js";
import { auditLogPath } from "./index.js";

/**
 * Reads and parses audit log entries. Skips malformed lines silently.
 * Returns events newest-first (last written = index 0).
 */
export function readAuditLog(cwd: string): AuditEvent[] {
  const logPath = auditLogPath(cwd);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  const events: AuditEvent[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as AuditEvent);
    } catch {
      // Corrupt line — silently skip, never crash on bad log data
    }
  }

  return events.reverse(); // newest first
}

/**
 * Summarises an audit log into a grouped count of violations per rule.
 * Returns a sorted array from most-violated to least.
 */
export function summariseAuditLog(events: AuditEvent[]): Array<{ ruleId: string; blocked: number; warned: number }> {
  const counts = new Map<string, { blocked: number; warned: number }>();

  for (const e of events) {
    const existing = counts.get(e.ruleId) ?? { blocked: 0, warned: 0 };
    if (e.severity === "BLOCKED") existing.blocked += 1;
    else existing.warned += 1;
    counts.set(e.ruleId, existing);
  }

  return [...counts.entries()]
    .map(([ruleId, c]) => ({ ruleId, ...c }))
    .sort((a, b) => (b.blocked + b.warned) - (a.blocked + a.warned));
}
