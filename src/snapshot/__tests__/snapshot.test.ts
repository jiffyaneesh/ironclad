import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureSnapshot, listSnapshots, restoreSnapshot } from "../index.js";

function makeTmpRepo(): string {
  const dir = join(tmpdir(), `ironclad-snap-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("snapshot", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpRepo();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns null when no files exist to snapshot", () => {
    const result = captureSnapshot(cwd, ["ghost.ts"]);
    expect(result).toBeNull();
  });

  it("captures existing file content", () => {
    writeFileSync(join(cwd, "foo.ts"), "original content");
    const snap = captureSnapshot(cwd, ["foo.ts"]);

    expect(snap).not.toBeNull();
    expect(snap!.files).toEqual(["foo.ts"]);
    expect(snap!.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/);
  });

  it("lists snapshots newest first", () => {
    writeFileSync(join(cwd, "a.ts"), "v1");
    const s1 = captureSnapshot(cwd, ["a.ts"])!;

    // Briefly delay to ensure different timestamp
    const start = Date.now();
    while (Date.now() - start < 2) { /* busy wait 2ms */ }

    writeFileSync(join(cwd, "a.ts"), "v2");
    const s2 = captureSnapshot(cwd, ["a.ts"])!;

    const listed = listSnapshots(cwd);
    expect(listed.length).toBeGreaterThanOrEqual(2);
    // newest should come first (lexicographically descending)
    expect(listed[0].id >= listed[1].id).toBe(true);
  });

  it("restores snapshotted file content", () => {
    writeFileSync(join(cwd, "b.ts"), "before edit");
    const snap = captureSnapshot(cwd, ["b.ts"])!;

    // Simulate an edit
    writeFileSync(join(cwd, "b.ts"), "after edit");
    expect(readFileSync(join(cwd, "b.ts"), "utf-8")).toBe("after edit");

    // Rollback
    const restored = restoreSnapshot(cwd, snap.id);
    expect(restored).toEqual(["b.ts"]);
    expect(readFileSync(join(cwd, "b.ts"), "utf-8")).toBe("before edit");
  });

  it("returns null for non-existent snapshot id", () => {
    const result = restoreSnapshot(cwd, "no-such-id");
    expect(result).toBeNull();
  });
});
