import type { LLMClient } from "./types.js";
import { AnthropicClient } from "./anthropic.js";
import { OpenAIClient } from "./openai.js";
import { GeminiClient } from "./gemini.js";

export type Provider = "anthropic" | "openai" | "gemini";

export interface ProviderConfig {
  /** Explicit provider override. If omitted, auto-detected from env vars. */
  provider?: Provider;
  /** Model override. Defaults are: anthropic=claude-opus-4-5, openai=gpt-4o, gemini=gemini-2.0-flash */
  model?: string;
}

/**
 * Creates the right LLMClient from config + environment.
 *
 * Detection order when provider is not explicit:
 *   ANTHROPIC_API_KEY → openai → OPENAI_API_KEY → GEMINI_API_KEY / GOOGLE_API_KEY
 */
export function createLLMClient(config: ProviderConfig = {}): LLMClient {
  const provider = config.provider ?? detectProvider();

  switch (provider) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Provider 'anthropic' selected but ANTHROPIC_API_KEY is not set");
      return new AnthropicClient(apiKey, config.model);
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("Provider 'openai' selected but OPENAI_API_KEY is not set");
      return new OpenAIClient(apiKey, config.model);
    }
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("Provider 'gemini' selected but neither GEMINI_API_KEY nor GOOGLE_API_KEY is set");
      return new GeminiClient(apiKey, config.model);
    }
  }
}

function detectProvider(): Provider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY) return "gemini";

  throw new Error(
    [
      "No LLM provider detected. Set one of:",
      "  ANTHROPIC_API_KEY  (uses claude-opus-4-5)",
      "  OPENAI_API_KEY     (uses gpt-4o)",
      "  GEMINI_API_KEY     (uses gemini-2.0-flash)",
      "Or pass --provider <anthropic|openai|gemini> explicitly.",
    ].join("\n")
  );
}

export type { LLMClient } from "./types.js";
