import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  LLMMessage,
  LLMResponse,
  MessagePart,
  ToolDefinition,
  ToolResultPart,
} from "./types.js";

export class AnthropicClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = "claude-opus-4-5") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    system: string
  ): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      tools: tools.map(toAnthropicTool),
      messages: messages.map(toAnthropicMessage),
    });

    return {
      content: response.content.map(fromAnthropicBlock),
      stopReason: response.stop_reason ?? "end_turn",
    };
  }
}

// ---- Outbound (normalized → Anthropic) --------------------------------------

function toAnthropicMessage(msg: LLMMessage): Anthropic.MessageParam {
  if (msg.role === "user") {
    return {
      role: "user",
      content: msg.content.map((p): Anthropic.TextBlockParam | Anthropic.ToolResultBlockParam => {
        if (p.type === "text") return { type: "text", text: p.text };
        if (p.type === "tool_result") {
          return {
            type: "tool_result",
            tool_use_id: p.tool_use_id,
            content: p.content,
            is_error: p.is_error,
          };
        }
        throw new Error(`Unexpected part type in user message: ${(p as MessagePart).type}`);
      }),
    };
  }

  return {
    role: "assistant",
    content: msg.content.map((p): Anthropic.ContentBlock => {
      if (p.type === "text") return { type: "text", text: p.text };
      if (p.type === "tool_use") {
        return { type: "tool_use", id: p.id, name: p.name, input: p.input };
      }
      throw new Error(`Unexpected part type in assistant message: ${(p as MessagePart).type}`);
    }),
  };
}

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  };
}

// ---- Inbound (Anthropic → normalized) ---------------------------------------

function fromAnthropicBlock(block: Anthropic.ContentBlock): MessagePart {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    };
  }
  // thinking blocks and any future types — surface as text so the loop isn't surprised
  return { type: "text", text: JSON.stringify(block) };
}

export type { ToolResultPart }; // re-export for convenience
