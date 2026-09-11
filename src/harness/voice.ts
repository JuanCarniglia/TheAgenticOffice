import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AgentId, Provider } from "../shared/types.js";
import { workerById } from "../shared/roster.js";
import { tokenBudgetSpent } from "../shared/guardrails.js";
import { officeLog } from "../shared/trace.js";
import { createChatModel, TokenMeterHandler } from "./llm.js";
import { performCursorVoice } from "./cursorVoice.js";

export interface PerformLineOpts {
  provider: Provider;
  model: string;
  todayTokens: number;
  agentId: AgentId;
  cue?: string;
  fallback: string;
  max?: number;
  /** If the draft has prices/qty, drop the model line when those digits vanish. */
  strictFacts?: boolean;
  onTokens?: (n: number) => void;
}

function firstLine(text: string, max: number): string {
  const clipped = text
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .split(/\n/)[0]
    ?.trim() ?? "";
  return clipped.slice(0, max);
}

function keepsFacts(out: string, fallback: string): boolean {
  const nums = fallback.match(/\$?\d+(?:\.\d+)?/g) ?? [];
  return nums.every((n) => out.includes(n));
}

function voiceSystem(agentId: AgentId, max: number): string {
  const worker = workerById(agentId);
  return [
    `You are ${worker.name}, ${worker.role} at a paper company.`,
    `Style: ${worker.style}`,
    `Personality: ${worker.personality}`,
    "The office is directing you — do not recite a script.",
    `Speak ONE line as yourself. No quotation marks. Under ${max} characters.`,
    "If the direction lists prices, quantities, or paper names, keep those exact.",
  ].join(" ");
}

/** Mock / cap / missing cue → fallback. OpenAI, Anthropic, and Cursor perform the cue. */
export async function performLine(opts: PerformLineOpts): Promise<string> {
  const fallback = opts.fallback.trim();
  const max = opts.max ?? 110;
  const cue = opts.cue?.trim();
  if (!cue || opts.provider === "mock") return fallback;
  if (tokenBudgetSpent(opts.todayTokens)) return fallback;

  officeLog("llm-out", `voice ${opts.agentId}: ${cue}`);
  try {
    let raw = "";
    if (opts.provider === "cursor") {
      const done = await performCursorVoice(
        opts.model,
        `${voiceSystem(opts.agentId, max)}\n\nDirection: ${cue}`,
      );
      raw = done.text;
      if (done.tokens) opts.onTokens?.(done.tokens);
    } else {
      const meter = new TokenMeterHandler((n) => opts.onTokens?.(n));
      const llm = createChatModel(opts.provider, opts.model, meter);
      const res = await llm.invoke([
        new SystemMessage(voiceSystem(opts.agentId, max)),
        new HumanMessage(cue),
      ]);
      raw = typeof res.content === "string" ? res.content : String(res.content ?? "");
    }
    const out = firstLine(raw, max);
    officeLog("llm-in", `voice ${opts.agentId}: ${out || fallback}`);
    if (!out) return fallback;
    if (opts.strictFacts && !keepsFacts(out, fallback)) return fallback;
    return out;
  } catch (err) {
    officeLog("llm-in", `voice ${opts.agentId} fallback: ${err instanceof Error ? err.message : "error"}`);
    return fallback;
  }
}
