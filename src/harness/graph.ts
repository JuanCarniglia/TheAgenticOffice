import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { isSales, workerById } from "../shared/roster.js";
import type { AgentId, OfficeEvent } from "../shared/types.js";
import { PHONE_CHAT_RULES } from "../shared/guardrails.js";
import { createChatModel, TokenMeterHandler } from "./llm.js";
import {
  defaultBoard,
  emitBooks,
  formatSlimBoard,
  isLiveOffice,
  recordTokens,
  seedQueues,
  sessionStartedEvent,
  type OfficeState,
} from "./officeState.js";
import { createOfficeTools, filterNamedTools, SALES_LIVE_TOOLS } from "./tools.js";
import { LongTermMemory } from "./memory.js";
import { officeLog } from "../shared/trace.js";

export type GraphHandle = {
  kind: "sales";
  sessionId: string;
  checkpointer: MemorySaver;
  callGen: Partial<Record<AgentId, number>>;
};

export async function startGraphSession(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  _memory: LongTermMemory,
): Promise<GraphHandle> {
  state.tasks = defaultBoard();
  seedQueues(state);
  emit(sessionStartedEvent(state));
  emitBooks(state, emit);
  emit({ type: "stock", items: state.stock.map((s) => ({ ...s })) });
  return {
    kind: "sales",
    sessionId: `office-${Date.now()}`,
    checkpointer: new MemorySaver(),
    callGen: {},
  };
}

export function resetCallThread(graph: GraphHandle, agentId?: AgentId): void {
  if (agentId) {
    graph.callGen[agentId] = (graph.callGen[agentId] ?? 0) + 1;
    return;
  }
  graph.callGen.jim = (graph.callGen.jim ?? 0) + 1;
  graph.callGen.dwight = (graph.callGen.dwight ?? 0) + 1;
}

function callThreadId(graph: GraphHandle, agentId: AgentId): string {
  const gen = graph.callGen[agentId] ?? 0;
  return `call-${graph.sessionId}-${agentId}-${gen}`;
}

async function slimWithMemory(
  state: OfficeState,
  memory: LongTermMemory,
  speaker: AgentId,
  query: string,
): Promise<string> {
  const facts = await memory.recall(speaker, query, 3);
  return formatSlimBoard(state, memory.formatRecall(facts));
}

export async function runGraphTick(
  graph: GraphHandle,
  state: OfficeState,
  _threadId: string,
  memory: LongTermMemory,
  emit: (e: OfficeEvent) => void,
): Promise<void> {
  const to = state.lastCustomerTo;
  const asked = state.lastCustomerText;
  if (!to || !asked || !isSales(to)) return;

  const worker = workerById(to);
  const meter = new TokenMeterHandler((n) => recordTokens(state, n, emit));
  const llm = createChatModel(state.provider, state.model, meter);
  const all = createOfficeTools({ state, emit, agentId: to, memory });
  const live = isLiveOffice(state);
  const tools = live ? filterNamedTools(all, SALES_LIVE_TOOLS) : all.filter((t) => t.name === "pitch_customer");
  const board = await slimWithMemory(state, memory, to, asked);
  const prompt = live
    ? [
        `You are ${worker.name}, ${worker.role} at a paper company, on a phone call.`,
        `Style: ${worker.style}`,
        "You must call pitch_customer once with a NEW reply under 180 characters.",
        "You may recall/remember customer prefs, or dm Angela (price) / Dwight (GSM) if needed. Then pitch.",
        "Do not invent a sale. Do not walk away from the desk. Do not call a meeting.",
        "Stay on the Open deal article. Do not switch SKU because a quantity matches a GSM.",
        PHONE_CHAT_RULES,
      ].join("\n")
    : [
        `You are ${worker.name}, ${worker.role} at a paper company, on a phone call.`,
        `Style: ${worker.style}`,
        "Call pitch_customer once with a NEW reply under 180 characters.",
        "Stay on the Open deal article. Do not switch SKU because a quantity matches a GSM.",
        PHONE_CHAT_RULES,
      ].join("\n");
  officeLog("llm-out", `sales ${to} asked: ${asked}`);
  officeLog("llm-out", "system", prompt);
  officeLog("llm-out", "board\n" + board);

  const agent = createReactAgent({
    llm,
    tools,
    name: to,
    prompt,
    checkpointer: live ? graph.checkpointer : undefined,
  });

  const config = live
    ? { configurable: { thread_id: callThreadId(graph, to) }, recursionLimit: 8 }
    : { recursionLimit: 6 };

  await agent.invoke(
    { messages: [new HumanMessage(`${board}\n\nCall pitch_customer once.`)] },
    config,
  );

  const reply = state.pendingCustomer?.question ?? "";
  officeLog("llm-in", `pitch ${to}: ${reply || "(no pitch_customer)"}`);
  if (state.lastLiveTokens) {
    emit({
      type: "trace",
      agentId: to,
      tool: "sales_turn",
      summary: reply.slice(0, 80) || "live sales turn",
      tokens: state.lastLiveTokens,
    });
  }
  state.lastCustomerText = "";
  state.lastCustomerTo = null;
}
