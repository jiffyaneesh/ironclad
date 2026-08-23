import { describe, it, expect } from "vitest";
import { compactHistory } from "../compaction.js";
import type { LLMMessage } from "../../llm/types.js";

describe("compactHistory", () => {
  it("leaves recent turns intact", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: [{ type: "text", text: "query" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "1", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "A".repeat(500) }] },
    ];

    const result = compactHistory(messages, 2);
    // Less than keepRecentTurns * 2 messages => no compaction
    expect(result[2].content[0]).toEqual(messages[2].content[0]);
  });

  it("prunes large tool results in older turns while keeping recent turns untouched", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: [{ type: "text", text: "turn 1" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "1", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "OLD_DATA_".repeat(100) }] },
      { role: "assistant", content: [{ type: "tool_use", id: "2", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "2", content: "RECENT_DATA_".repeat(100) }] },
    ];

    const result = compactHistory(messages, 1);
    const oldResult = result[2].content[0] as { type: string; content: string };
    const recentResult = result[4].content[0] as { type: string; content: string };

    expect(oldResult.content).toContain("pruned for token quota");
    expect(recentResult.content).toContain("RECENT_DATA_");
    expect(recentResult.content).not.toContain("pruned for token quota");
  });
});
