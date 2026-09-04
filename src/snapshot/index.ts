import { mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { GLOBAL_DIR } from "../config/paths.js";

/** A single snapshot entry: which files were captured and at what time. */
export interface Snapshot {
  id: string;       // ISO timestamp slug, e.g. "2026-09-04T23-39-08"
  createdAt: string; // ISO timestamp
  files: string[];  // repo-relative paths that were snapshotted
}

function snapshotsRoot(cwd: string): string {
  return join(cwd, ".ironclad", "snapshots");
}

function idToDir(cwd: string, id: string): string {
  return join(snapshotsRoot(cwd), id);
}

function makeId(): string {
  // Include milliseconds so rapid successive snapshots get unique ids
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
}

/**
 * Captures the current content of the given files into a timestamped snapshot directory.
 * Returns the snapshot id, or null if no files existed to snapshot.
 */
export function captureSnapshot(cwd: string, repoPaths: string[]): Snapshot | null {
  const existing = repoPaths.filter((p) => existsSync(join(cwd, p)));
  if (existing.length === 0) return null;

  const id = makeId();
  const snapDir = idToDir(cwd, id);
  mkdirSync(snapDir, { recursive: true });

  for (const rel of existing) {
    const src = join(cwd, rel);
    const dst = join(snapDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }

  const meta: Snapshot = { id, createdAt: new Date().toISOString(), files: existing };
  writeFileSync(join(snapDir, ".meta.json"), JSON.stringify(meta, null, 2));

  return meta;
}

/**
 * Lists all snapshots in the workspace, newest first.
 */
export function listSnapshots(cwd: string): Snapshot[] {
  const root = snapshotsRoot(cwd);
  if (!existsSync(root)) return [];

  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse(); // newest first

  const snapshots: Snapshot[] = [];
  for (const id of dirs) {
    const metaPath = join(root, id, ".meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Snapshot;
      snapshots.push(meta);
    } catch {
      // corrupt meta — skip
    }
  }
  return snapshots;
}

/**
 * Restores a snapshot by id, overwriting current files with snapshot contents.
 * Returns the list of files restored, or null if snapshot not found.
 */
export function restoreSnapshot(cwd: string, id: string): string[] | null {
  const snapDir = idToDir(cwd, id);
  if (!existsSync(snapDir)) return null;

  const metaPath = join(snapDir, ".meta.json");
  if (!existsSync(metaPath)) return null;

  const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Snapshot;

  for (const rel of meta.files) {
    const src = join(snapDir, rel);
    const dst = join(cwd, rel);
    if (existsSync(src)) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
  }

  return meta.files;
}
