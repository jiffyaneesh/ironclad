import OpenAI from "openai";
import { withRetry } from "./retry.js";
import type {
  LLMClient,
  LLMMessage,
  LLMResponse,
  MessagePart,
  ToolDefinition,
  ToolResultPart,
  ToolUsePart,
} from "./types.js";

export class OpenAIClient implements LLMClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = "gpt-4o") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    system: string
  ): Promise<LLMResponse> {
    const response = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages: toOpenAIMessages(messages, system),
        tools: tools.map(toOpenAITool),
        tool_choice: "auto",
      })
    );

    return fromOpenAIChoice(response.choices[0]);
  }
}

// ---- Outbound (normalized → OpenAI) -----------------------------------------

type OAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

function toOpenAIMessages(messages: LLMMessage[], system: string): OAIMessage[] {
  const result: OAIMessage[] = [{ role: "system", content: system }];

  for (const msg of messages) {
    if (msg.role === "user") {
      // OpenAI represents tool results as separate messages with role "tool",
      // not as content blocks inside a user message like Anthropic does.
      const textParts = msg.content.filter((p) => p.type === "text");
      const toolResults = msg.content.filter(
        (p): p is ToolResultPart => p.type === "tool_result"
      );

      if (textParts.length > 0) {
        const text = textParts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
        result.push({ role: "user", content: text });
      }
      for (const tr of toolResults) {
        result.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.content });
      }
    } else {
      // assistant message — may contain tool_use parts (parallel tool calls)
      const toolUseParts = msg.content.filter(
        (p): p is ToolUsePart => p.type === "tool_use"
      );
      const text =
        msg.content
          .filter((p) => p.type === "text")
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("\n") || null;

      if (toolUseParts.length > 0) {
        result.push({
          role: "assistant",
          content: text,
          tool_calls: toolUseParts.map((p) => ({
            id: p.id,
            type: "function" as const,
            function: { name: p.name, arguments: JSON.stringify(p.input) },
          })),
        });
      } else {
        result.push({ role: "assistant", content: text ?? "" });
      }
    }
  }

  return result;
}

function toOpenAITool(tool: ToolDefinition): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      // OpenAI accepts a JSON Schema object directly here
      parameters: tool.parameters as Record<string, unknown>,
    },
  };
}

// ---- Inbound (OpenAI → normalized) ------------------------------------------

function fromOpenAIChoice(
  choice: OpenAI.Chat.ChatCompletion.Choice
): LLMResponse {
  const content: MessagePart[] = [];

  if (choice.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  for (const tc of choice.message.tool_calls ?? []) {
    // Filter to standard function calls — the SDK union includes a custom tool call
    // variant without a .function property; we don't use custom tools.
    if (tc.type !== "function") continue;
    // JSON.parse is unavoidable — OpenAI returns arguments as a raw JSON string
    const input = JSON.parse(tc.function.arguments) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }

  const stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
  return { content, stopReason };
}
