import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { workerById } from "../shared/roster.js";
import type { OfficeEvent } from "../shared/types.js";
import { PHONE_CHAT_RULES } from "../shared/guardrails.js";
import { createChatModel, TokenMeterHandler } from "./llm.js";
import {
  defaultBoard,
  emitBooks,
  formatSlimBoard,
  recordTokens,
  seedQueues,
  sessionStartedEvent,
  type OfficeState,
} from "./officeState.js";
import { createOfficeTools } from "./tools.js";
import { LongTermMemory } from "./memory.js";
import { rememberSalesReply } from "./salesScript.js";

export type GraphHandle = { kind: "sales" };

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
  return { kind: "sales" };
}

export async function runGraphTick(
  _graph: GraphHandle,
  state: OfficeState,
  _threadId: string,
  memory: LongTermMemory,
  emit: (e: OfficeEvent) => void,
): Promise<void> {
  const to = state.lastCustomerTo;
  const asked = state.lastCustomerText;
  if (!to || !asked) return;

  const worker = workerById(to);
  const meter = new TokenMeterHandler((n) => recordTokens(state, n, emit));
  const llm = createChatModel(state.provider, state.model, meter);
  const tools = createOfficeTools({ state, emit, agentId: to, memory }).filter(
    (t) => t.name === "pitch_customer",
  );
  const agent = createReactAgent({
    llm,
    tools,
    name: to,
    prompt: [
      `You are ${worker.name}, ${worker.role} at a paper company, on a phone call.`,
      `Style: ${worker.style}`,
      "Call pitch_customer once with a NEW reply under 180 characters.",
      PHONE_CHAT_RULES,
    ].join("\n"),
  });

  await agent.invoke({
    messages: [new HumanMessage(`${formatSlimBoard(state)}\n\nCall pitch_customer once.`)],
  });

  const reply = state.pendingCustomer?.question ?? "";
  if (reply) rememberSalesReply(to, asked, reply);
  state.lastCustomerText = "";
  state.lastCustomerTo = null;
}
