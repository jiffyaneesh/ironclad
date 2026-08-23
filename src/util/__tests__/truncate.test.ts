import { describe, it, expect } from "vitest";
import { truncateOutput } from "../truncate.js";

describe("truncateOutput", () => {
  it("does not truncate small outputs", () => {
    const text = "Line 1\nLine 2\nLine 3";
    const res = truncateOutput(text, { maxLines: 10, maxChars: 1000 });
    expect(res.truncated).toBe(false);
    expect(res.content).toBe(text);
    expect(res.totalLines).toBe(3);
  });

  it("truncates lines when exceeding maxLines and preserves head and tail", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n");
    const res = truncateOutput(lines, { maxLines: 20, maxChars: 10000 });
    expect(res.truncated).toBe(true);
    expect(res.totalLines).toBe(100);
    expect(res.content).toContain("Line 1");
    expect(res.content).toContain("Line 100");
    expect(res.content).toContain("lines truncated for context budget");
  });

  it("normalizes CRLF line endings to LF", () => {
    const text = "Line 1\r\nLine 2\r\nLine 3";
    const res = truncateOutput(text);
    expect(res.content).not.toContain("\r\n");
    expect(res.content).toContain("\n");
  });
});
