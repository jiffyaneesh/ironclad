import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type Tool as GeminiTool,
  type FunctionDeclarationSchema,
} from "@google/generative-ai";
import type {
  LLMClient,
  LLMMessage,
  LLMResponse,
  MessagePart,
  ToolDefinition,
  ToolProperty,
  ToolResultPart,
  ToolUsePart,
} from "./types.js";

export class GeminiClient implements LLMClient {
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: string;

  constructor(apiKey: string, model = "gemini-3.6-flash") {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    system: string
  ): Promise<LLMResponse> {
    const geminiModel = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: system,
      tools: [{ functionDeclarations: tools.map(toGeminiFunctionDeclaration) } as GeminiTool],
    });

    const contents = toGeminiContents(messages);
    const result = await geminiModel.generateContent({ contents });

    return fromGeminiResponse(result.response.candidates?.[0]?.content);
  }
}

// ---- Outbound (normalized → Gemini) -----------------------------------------

function toGeminiContents(messages: LLMMessage[]): Content[] {
  return messages.map((msg) => ({
    // Gemini supports "user" and "model" roles
    role: msg.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(msg.content),
  }));
}

function toGeminiParts(parts: MessagePart[]): Part[] {
  return parts.flatMap((p): Part[] => {
    if (p.type === "text") return [{ text: p.text }];
    if (p.type === "tool_use") {
      return [{ functionCall: { name: p.name, args: p.input } }];
    }
    if (p.type === "tool_result") {
      // Gemini matches function responses by function name, not by call ID.
      // We store the function name as the tool_use_id in fromGeminiResponse below.
      return [
        {
          functionResponse: {
            name: p.tool_use_id,
            response: { content: p.content, is_error: p.is_error ?? false },
          },
        },
      ];
    }
    return [];
  });
}

function toGeminiFunctionDeclaration(tool: ToolDefinition): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      // The Gemini SDK's SchemaType enum isn't exported reliably across versions,
      // so we cast to the expected schema shape. The runtime value "OBJECT" is correct.
      type: "OBJECT" as FunctionDeclarationSchema["type"],
      // cast: SDK's Schema type for nested properties is overly strict and doesn't
      // accept plain {type, description} objects even though the API does.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([k, v]) => [
          k,
          toGeminiPropertySchema(v),
        ])
      ) as any,
      required: tool.parameters.required,
    },
  };
}

function toGeminiPropertySchema(prop: ToolProperty): Record<string, unknown> {
  return {
    // Same casting rationale as above — SchemaType is not reliably importable
    type: "STRING" as string,
    description: prop.description ?? "",
  };
}

// ---- Inbound (Gemini → normalized) ------------------------------------------

function fromGeminiResponse(content: Content | undefined): LLMResponse {
  const parts: MessagePart[] = [];

  for (const part of content?.parts ?? []) {
    if (part.text) {
      parts.push({ type: "text", text: part.text });
    } else if (part.functionCall) {
      // Gemini doesn't emit call IDs — we use the function name as the ID.
      // This means two simultaneous calls to the same function in one turn
      // would collide; in practice, Gemini serializes tool calls so this
      // doesn't arise. If it ever does, add a counter suffix here.
      parts.push({
        type: "tool_use",
        id: part.functionCall.name,
        name: part.functionCall.name,
        input: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }

  const stopReason = parts.some((p) => p.type === "tool_use") ? "tool_use" : "end_turn";
  return { content: parts, stopReason };
}

export type { ToolResultPart, ToolUsePart }; // re-export for convenience
