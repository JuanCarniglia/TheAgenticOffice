import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import type { UsageMetadata } from "@langchain/core/messages";
import type { Provider } from "../shared/types.js";

export type ChatModel = ChatOpenAI | ChatAnthropic;

export function tokensFromLlmResult(output: LLMResult): number {
  const raw = output.llmOutput ?? {};
  const tu = (raw.tokenUsage ?? raw.token_usage ?? raw.usage) as
    | {
        totalTokens?: number;
        total_tokens?: number;
        promptTokens?: number;
        completionTokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
      }
    | undefined;
  if (tu) {
    const total =
      tu.totalTokens ??
      tu.total_tokens ??
      (tu.promptTokens ?? tu.prompt_tokens ?? 0) + (tu.completionTokens ?? tu.completion_tokens ?? 0);
    if (total) return total;
  }
  let n = 0;
  for (const gens of output.generations) {
    for (const g of gens) {
      const um = (g as { message?: { usage_metadata?: UsageMetadata } }).message?.usage_metadata;
      if (um) n += um.total_tokens ?? um.input_tokens + um.output_tokens;
    }
  }
  return n;
}

export class TokenMeterHandler extends BaseCallbackHandler {
  name = "office_token_meter";

  constructor(private readonly onTokens: (n: number) => void) {
    super();
  }

  async handleLLMEnd(output: LLMResult): Promise<void> {
    const n = tokensFromLlmResult(output);
    if (n > 0) this.onTokens(n);
  }
}

export function createChatModel(
  provider: Provider,
  model: string,
  meter?: TokenMeterHandler,
): ChatModel {
  const callbacks = meter ? [meter] : undefined;
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is missing in the harness .env");
    }
    return new ChatOpenAI({
      model,
      temperature: 0.6,
      apiKey: process.env.OPENAI_API_KEY,
      callbacks,
    });
  }
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is missing in the harness .env");
    }
    return new ChatAnthropic({
      model,
      temperature: 0.6,
      apiKey: process.env.ANTHROPIC_API_KEY,
      callbacks,
    });
  }
  if (provider === "cursor") {
    throw new Error("Cursor provider uses the Cursor SDK, not LangChain");
  }
  throw new Error("Mock provider does not use an LLM");
}
