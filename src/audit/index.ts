import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/** A single audit log entry. Written as one JSON line per event. */
export interface AuditEvent {
  timestamp: string;        // ISO 8601
  severity: "BLOCKED" | "WARNING";
  ruleId: string;
  message: string;
  toolName: string;         // e.g. "edit_file", "run_command"
  filePath?: string;        // populated for edit_file violations
  command?: string;         // populated for run_command violations
  taskDescription?: string; // first 80 chars of the active task
}

/** Workspace-scoped audit log path. */
export function auditLogPath(cwd: string): string {
  return join(cwd, ".ironclad", "audit.log");
}

/**
 * Appends a single JSON line to the workspace audit log.
 * Creates the .ironclad directory if it doesn't exist.
 */
export function appendAuditEvent(cwd: string, event: AuditEvent): void {
  const logPath = auditLogPath(cwd);
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + "\n", "utf-8");
}
