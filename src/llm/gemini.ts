import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type Tool as GeminiTool,
  type FunctionDeclarationSchema,
} from "@google/generative-ai";
import { withRetry } from "./retry.js";
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
    const result = await withRetry(() =>
      geminiModel.generateContent({ contents })
    );

    return fromGeminiResponse(result.response.candidates?.[0]?.content);
  }
}

// ---- Outbound (normalized → Gemini) -----------------------------------------

function toGeminiContents(messages: LLMMessage[]): Content[] {
  return messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(msg.content),
  }));
}

function toGeminiParts(parts: MessagePart[]): Part[] {
  return parts.flatMap((p): Part[] => {
    // If we preserved the original raw Gemini Part, send it back unchanged (preserves thought_signature / metadata)
    if ("rawPart" in p && p.rawPart) {
      return [p.rawPart as Part];
    }
    if (p.type === "text") return [{ text: p.text }];
    if (p.type === "tool_use") {
      return [{ functionCall: { name: p.name, args: p.input } }];
    }
    if (p.type === "tool_result") {
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
      type: "OBJECT" as FunctionDeclarationSchema["type"],
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
    type: "STRING" as string,
    description: prop.description ?? "",
  };
}

// ---- Inbound (Gemini → normalized) ------------------------------------------

function fromGeminiResponse(content: Content | undefined): LLMResponse {
  const parts: MessagePart[] = [];

  for (const part of content?.parts ?? []) {
    if (part.text) {
      parts.push({
        type: "text",
        text: part.text,
        rawPart: part,
      });
    } else if (part.functionCall) {
      parts.push({
        type: "tool_use",
        id: part.functionCall.name,
        name: part.functionCall.name,
        input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        rawPart: part,
      });
    }
  }

  const stopReason = parts.some((p) => p.type === "tool_use") ? "tool_use" : "end_turn";
  return { content: parts, stopReason };
}

export type { ToolResultPart, ToolUsePart };
