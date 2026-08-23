import type { LLMMessage, ToolResultPart } from "../llm/types.js";

/**
 * Message and tool output compaction utility.
 * Mimics OpenCode's compaction mechanism: keeps full outputs for the most recent 2 turns,
 * while trimming bloated tool outputs from older turns to prevent TPM rate limits and context blowup.
 */

const MAX_OLD_TOOL_RESULT_LENGTH = 300;

export function compactHistory(messages: LLMMessage[], keepRecentTurns = 2): LLMMessage[] {
  if (messages.length <= keepRecentTurns * 2) {
    return messages;
  }

  const cutoffIndex = messages.length - keepRecentTurns * 2;

  return messages.map((msg, idx) => {
    if (idx >= cutoffIndex || msg.role !== "user") {
      return msg;
    }

    // Prune tool_results in older turns
    const compactedParts = msg.content.map((part) => {
      if (part.type === "tool_result") {
        if (part.content.length > MAX_OLD_TOOL_RESULT_LENGTH) {
          const preview = part.content.slice(0, MAX_OLD_TOOL_RESULT_LENGTH);
          const omitted = part.content.length - MAX_OLD_TOOL_RESULT_LENGTH;
          return {
            ...part,
            content: `${preview}\n... [${omitted} chars pruned for token quota]`,
          } as ToolResultPart;
        }
      }
      return part;
    });

    return {
      ...msg,
      content: compactedParts,
    };
  });
}
