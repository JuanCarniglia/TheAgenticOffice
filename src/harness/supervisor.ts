import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { isSales, workerById } from "../shared/roster.js";
import type { AgentId, OfficeEvent } from "../shared/types.js";
import { createChatModel, TokenMeterHandler } from "./llm.js";
import { formatSlimBoard, isLiveOffice, recordTokens, type OfficeState } from "./officeState.js";
import { createOfficeTools } from "./tools.js";
import { LongTermMemory } from "./memory.js";
import { endMeeting, sendHome } from "./environment.js";

const MICHAEL_TOOLS = new Set(["say", "assign_task", "update_task", "call_meeting", "dm", "ask_human"]);
const ANGELA_TOOLS = new Set(["say", "assign_task", "update_task", "dm", "ask_human", "remember"]);
const CLOSER_TOOLS = new Set(["say", "dm", "update_task"]);

export type SupervisorReason = "standup" | "stall" | "reorder" | "sale100";

export function supervisorKey(reason: SupervisorReason, extra?: string): string {
  return extra ? `${reason}:${extra}` : reason;
}

export function queueSupervisor(state: OfficeState, reason: SupervisorReason, extra?: string): void {
  if (!isLiveOffice(state)) return;
  const key = supervisorKey(reason, extra);
  if (state.supervisorDone.includes(key)) return;
  if (state.pendingSupervisor) return;
  state.pendingSupervisor = key;
}

function reasonPrompt(state: OfficeState, key: string): string {
  const closer = isSales(state.callTarget) ? state.callTarget : state.outreachLead;
  const name = workerById(closer === "dwight" ? "dwight" : "jim").name;
  if (key === "standup") {
    return [
      "10:00 standup. Review the board in one or two actions.",
      "Nag the close. Assign or update a ticket if the board is stale.",
      "Do not start a long meeting. Do not talk to the customer.",
      formatSlimBoard(state),
    ].join("\n");
  }
  if (key === "stall") {
    return [
      `${name} has had three live sales turns without a close.`,
      "Assign a backup, dm the closer, or ask HQ — then stop.",
      "Do not invent a customer reply.",
      formatSlimBoard(state),
    ].join("\n");
  }
  if (key.startsWith("reorder:")) {
    return [
      "Warehouse min hit. Angela owns reorder. Confirm the board and nag Pam in character.",
      "One or two actions. Do not ring up a sale.",
      formatSlimBoard(state),
    ].join("\n");
  }
  return [
    "A $100+ sale just landed. Congratulate, update tickets, keep morale up.",
    "One or two actions. Do not restart the pitch.",
    formatSlimBoard(state),
  ].join("\n");
}

export async function runSupervisorEvent(
  state: OfficeState,
  memory: LongTermMemory,
  emit: (e: OfficeEvent) => void,
): Promise<boolean> {
  const key = state.pendingSupervisor;
  if (!key || !isLiveOffice(state)) {
    state.pendingSupervisor = null;
    return false;
  }
  if (state.provider === "cursor") {
    state.supervisorDone.push(key);
    state.pendingSupervisor = null;
    emit({
      type: "say",
      agentId: "michael",
      text: key === "standup" ? "Alright people — sell the inbound. Tickets up." : "That's the energy. Stay on it.",
    });
    emit({ type: "trace", agentId: "michael", tool: "supervisor", summary: key });
    if (key === "standup" && state.meeting) {
      const done = endMeeting(state);
      if (done) emit({ type: "meeting_end", title: done.title });
      sendHome(state, emit);
    }
    return true;
  }

  const closer: AgentId = state.callTarget === "dwight" || state.outreachLead === "dwight" ? "dwight" : "jim";
  const tokensBefore = state.todayTokens;
  const meter = new TokenMeterHandler((n) => recordTokens(state, n, emit));
  const llm = createChatModel(state.provider, state.model, meter);

  const michaelTools = createOfficeTools({ state, emit, agentId: "michael", memory }).filter((t) =>
    MICHAEL_TOOLS.has(t.name),
  );
  const angela = createReactAgent({
    llm,
    tools: createOfficeTools({ state, emit, agentId: "angela", memory }).filter((t) => ANGELA_TOOLS.has(t.name)),
    name: "angela",
    prompt: "You are Angela, PM. Short, exact. Price sheet is firm. One tool then stop.",
  });
  const sales = createReactAgent({
    llm,
    tools: createOfficeTools({ state, emit, agentId: closer, memory }).filter((t) => CLOSER_TOOLS.has(t.name)),
    name: closer,
    prompt: `You are ${workerById(closer).name} in the office, not on a pitch. One short floor line or dm. Do not pitch the customer.`,
  });

  const workflow = createSupervisor({
    agents: [angela, sales],
    llm,
    tools: michaelTools,
    supervisorName: "michael",
    prompt: [
      "You are Michael, CEO. Handle ONE office event. One or two actions, then stop.",
      "You may assign_task, dm, say, ask_human, or hand off to angela / the closer.",
      "Do not talk to the lobby customer. Do not start a five-person meeting unless you must.",
    ].join(" "),
    outputMode: "last_message",
    includeAgentName: "inline",
  });
  const app = workflow.compile();

  try {
    await app.invoke(
      { messages: [new HumanMessage(reasonPrompt(state, key))] },
      { recursionLimit: 8 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supervisor failed";
    emit({ type: "error", message });
    emit({ type: "say", agentId: "michael", text: "Okay — I'll take this offline. Stay on the sale." });
  }

  const spent = Math.max(0, state.todayTokens - tokensBefore);
  emit({
    type: "trace",
    agentId: "michael",
    tool: "supervisor",
    summary: key,
    tokens: spent || undefined,
  });
  state.supervisorDone.push(key);
  state.pendingSupervisor = null;

  if (key === "standup" && state.meeting) {
    const done = endMeeting(state);
    if (done) emit({ type: "meeting_end", title: done.title });
    sendHome(state, emit);
  }
  return true;
}

export function announceTokenCap(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  emit({
    type: "say",
    agentId: "michael",
    text: "That's the token budget. Scripted floor from here. Nobody panic.",
  });
  emit({ type: "trace", agentId: "michael", tool: "supervisor", summary: "tokencap" });
}
