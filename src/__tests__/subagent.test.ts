import { describe, it, expect, vi } from "vitest";
import { runSubagent } from "../subagent.js";
import type { LLMClient, LLMResponse } from "../llm/types.js";

describe("runSubagent", () => {
  it("runs an isolated subagent and completes without polluting parent context", async () => {
    const mockLlm: LLMClient = {
      chat: vi.fn().mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "task_complete",
            input: { summary: "Exploration finished: 5 files found" },
          },
        ],
        stopReason: "tool_use",
      } as LLMResponse),
    };

    const result = await runSubagent({
      task: "explore repository layout",
      cwd: ".",
      llm: mockLlm,
      rules: [],
      maxTurns: 3,
    });

    expect(result.status).toBe("complete");
    expect(result.summary).toBe("Exploration finished: 5 files found");
    expect(mockLlm.chat).toHaveBeenCalledTimes(1);
  });
});
