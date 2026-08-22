/**
 * Provider-agnostic LLM client interface.
 *
 * The agent loop is written against this interface. Each adapter (Anthropic,
 * OpenAI, Gemini) translates to/from its SDK's native format so the agent
 * never imports a provider SDK directly.
 */

// ---- Message parts ----------------------------------------------------------

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolUsePart {
  type: "tool_use";
  /** Unique call ID for correlating results. Providers that lack IDs (Gemini)
   *  generate one in the adapter. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultPart {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type MessagePart = TextPart | ToolUsePart | ToolResultPart;

// ---- Messages ---------------------------------------------------------------

export interface LLMMessage {
  role: "user" | "assistant";
  content: MessagePart[];
}

// ---- Tool definitions -------------------------------------------------------

export interface ToolProperty {
  type: string;
  description?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolProperty>;
    required: string[];
  };
}

// ---- Response ---------------------------------------------------------------

export interface LLMResponse {
  content: MessagePart[];
  /** Normalized stop reason. "tool_use" means the model wants to call a tool;
   *  "end_turn" means it's done. Other values are passed through as-is. */
  stopReason: "end_turn" | "tool_use" | string;
}

// ---- Client interface -------------------------------------------------------

export interface LLMClient {
  chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    system: string
  ): Promise<LLMResponse>;
}
