import type { AgentId, OfficeEvent, TaskStatus, ZoneId } from "../shared/types.js";
import { looksLikeGreeting, looksLikeHangup, looksLikeRejection, looksLikeSmallTalk, workerById } from "../shared/roster.js";
import { officeLog } from "../shared/trace.js";
import { formatClock } from "../shared/clock.js";
import {
  DEFAULT_PITCH_QTY,
  DEFAULT_PITCH_SKU,
  formatMoney,
  skuLabel,
} from "../shared/catalog.js";
import { findSku } from "../shared/commerce.js";
import { LongTermMemory, rememberShort } from "./memory.js";
import {
  defaultBoard,
  emitBooks,
  seedQueues,
  sessionStartedEvent,
  syncTicket,
  tryCloseSale,
  type OfficeState,
} from "./officeState.js";
import {
  applyLogin,
  applyLunch,
  applyStandup,
  applyWrap,
  dueSchedule,
  markFired,
  scriptedMeetingTurn,
} from "./environment.js";
import { cannedSalesReply, humanChatReply } from "./salesScript.js";
import { handlePamCallerReply, hangUpCall, queueInboundCall } from "./beats.js";

type WorkOp =
  | { t: "say"; agent: AgentId; text: string }
  | { t: "cooler"; agent: AgentId; text: string }
  | { t: "dm"; from: AgentId; to: AgentId; text: string }
  | { t: "move"; agent: AgentId; zone: ZoneId }
  | { t: "task"; id: string; status: TaskStatus; note: string }
  | { t: "create"; id: string; title: string; owner: AgentId; note: string }
  | { t: "remember"; agent: AgentId; text: string; kind: "gossip" | "decision" | "requirement" }
  | { t: "status"; agent: AgentId; status: string };

const MORNING: WorkOp[] = [
  { t: "cooler", agent: "pam", text: "If that phone rings, I get it first. Then I transfer." },
  { t: "status", agent: "jim", status: "at the desk — waiting on line one" },
  { t: "status", agent: "dwight", status: "at the desk — waiting on line one" },
  { t: "say", agent: "jim", text: "Whoever they ask for. I'm not fighting Dwight for the phone." },
  { t: "say", agent: "dwight", text: "Correct. The caller chooses. I will be ready." },
];

const AFTERNOON: WorkOp[] = [
  { t: "cooler", agent: "michael", text: "That's standup. Somebody close that human." },
  { t: "task", id: "AO-1", status: "done", note: "Goal posted" },
  { t: "task", id: "AO-2", status: "doing", note: "Sheet holds. No freelance discounts." },
];

const IDLE: WorkOp[] = [
  { t: "status", agent: "pam", status: "watching line one" },
  { t: "move", agent: "michael", zone: "water_cooler" },
  { t: "say", agent: "michael", text: "Do we have a close yet? Anyone?" },
  { t: "status", agent: "angela", status: "watching the price sheet" },
  { t: "cooler", agent: "pam", text: "They're on the phone. Don't hover, Michael." },
  { t: "move", agent: "michael", zone: "manager_office" },
];

export class MockEngine {
  private workIndex = 0;
  private morningIndex = 0;
  private idleIndex = 0;
  private followup: WorkOp[] = [];
  private memory = new LongTermMemory();

  async reset(state: OfficeState, emit: (e: OfficeEvent) => void): Promise<void> {
    this.workIndex = 0;
    this.morningIndex = 0;
    this.idleIndex = 0;
    this.followup = [];
    await this.memory.load();
    state.tasks = defaultBoard();
    seedQueues(state);
    state.lastPitchSkuId = DEFAULT_PITCH_SKU;
    state.lastPitchQty = DEFAULT_PITCH_QTY;
    emit(sessionStartedEvent(state));
    emit({ type: "tasks_replaced", tasks: state.tasks.map((t) => ({ ...t })) });
    emitBooks(state, emit);
    emit({ type: "stock", items: state.stock.map((s) => ({ ...s })) });
    await this.runScheduleIfDue(state, emit);
  }

  async tick(state: OfficeState, emit: (e: OfficeEvent) => void): Promise<void> {
    if (state.pendingHuman) return;
    if (await this.runScheduleIfDue(state, emit)) return;
    if (state.meeting) {
      scriptedMeetingTurn(state, emit);
      return;
    }
    if (this.followup.length) {
      const op = this.followup.shift()!;
      await this.apply(op, state, emit);
      return;
    }
    if (state.pendingCustomer) {
      if (this.idleIndex < IDLE.length) {
        const op = IDLE[this.idleIndex]!;
        this.idleIndex += 1;
        await this.apply(op, state, emit);
      }
      return;
    }
    if (this.morningIndex < MORNING.length) {
      const op = MORNING[this.morningIndex]!;
      this.morningIndex += 1;
      await this.apply(op, state, emit);
      return;
    }
    if (this.workIndex >= AFTERNOON.length) return;
    const op = AFTERNOON[this.workIndex]!;
    this.workIndex += 1;
    await this.apply(op, state, emit);
  }

  onCustomerSay(
    state: OfficeState,
    emit: (e: OfficeEvent) => void,
    to: AgentId,
    text: string,
  ): void {
    const time = formatClock(state.clock);
    state.pendingCustomer = null;
    state.lastCustomerTo = to;
    state.lastCustomerText = text;
    state.salesTurns += 1;
    const line = { from: "you" as const, to, text, time };
    state.customerLog.push(line);
    rememberShort(state.shortTerm, to, `Customer: ${text}`, time, "interaction");
    emit({ type: "customer_line", ...line });
    void this.memory.remember({ agentId: to, kind: "interaction", text: `Customer: ${text}`, time });
    officeLog("sales", `customer → ${to}: ${text} (turn ${state.salesTurns})`);

    if (looksLikeHangup(text) && (state.callPhase === "idle" || state.callPhase === "ringing")) {
      if (state.callPhase !== "idle") hangUpCall(state, emit, "pam");
      return;
    }
    if (state.callPhase === "idle") {
      queueInboundCall(state, to);
      return;
    }
    if (state.callPhase === "pam") {
      if (looksLikeHangup(text)) {
        hangUpCall(state, emit, "pam");
        return;
      }
      handlePamCallerReply(state, emit, text);
      return;
    }
    if (state.callPhase !== "live") return;

    if (tryCloseSale(state, emit, to, text)) {
      if (looksLikeHangup(text)) hangUpCall(state, emit, to);
      return;
    }
    if (looksLikeHangup(text)) {
      hangUpCall(state, emit, to);
      return;
    }

    const reply = cannedSalesReply(state, to, text) ?? this.salesReply(state, to, text);
    state.pendingCustomer = { agentId: to, requestId: crypto.randomUUID(), question: reply };
    const pitch = { from: to, to: "you" as const, text: reply, time };
    state.customerLog.push(pitch);
    emit({ type: "customer_line", from: to, to: "you", text: reply, time });
    emit({ type: "say", agentId: to, text: reply.slice(0, 110) });
    emit({ type: "status", agentId: to, status: `in chat with the customer` });
  }

  private salesReply(state: OfficeState, to: AgentId, text: string): string {
    const sku = findSku(state.stock, state.lastPitchSkuId);
    const label = sku ? skuLabel(sku) : "the paper";
    const qty = state.lastPitchQty;
    const price = sku ? formatMoney(sku.price) : "$8.50";
    const n = state.salesTurns;

    if (looksLikeRejection(text)) {
      return to === "dwight"
        ? "Understood. No pressure. Call back if you reconsider."
        : "Ha. All good. I'm here if you change your mind.";
    }

    if (looksLikeSmallTalk(text) || looksLikeGreeting(text) || n <= 2) {
      return humanChatReply(to, text, n);
    }

    if (to === "dwight") {
      const lines = [
        `If you called about paper, I have ${label}. Or we can continue talking.`,
        `I can quote ${qty} of ${label} at ${price} if you want numbers. Otherwise I will wait.`,
        `Jim is not authorized to discount. I can wait. What do you need?`,
        `I am still here. You may ask a question, or we can discuss the sheet.`,
      ];
      return lines[(n - 1) % lines.length]!;
    }

    const lines = [
      `So — what are you looking for? We do paper, if that's why you called.`,
      `If you want the lecture that's Dwight. If you want to keep chatting, I'm here.`,
      `Anyway. I can write up ${qty} of ${label} at ${price} — or we can just talk.`,
      `I don't want to loop a pitch. Tell me what you actually need.`,
    ];
    return lines[(n - 1) % lines.length]!;
  }

  onHumanReply(
    state: OfficeState,
    emit: (e: OfficeEvent) => void,
    agentId: AgentId,
    text: string,
  ): void {
    const time = formatClock(state.clock);
    state.pendingHuman = null;
    state.mailboxes[agentId].push({
      id: crypto.randomUUID(),
      from: "human",
      to: agentId,
      text,
      time,
    });
    rememberShort(state.shortTerm, agentId, `HQ replied: ${text}`, time, "decision");
    const clipped = text.length > 48 ? `${text.slice(0, 48)}…` : text;
    emit({ type: "say", agentId, text: `Copy that — “${clipped}”` });
    void this.memory.remember({
      agentId,
      kind: "decision",
      text: `HQ: ${text}`,
      time,
    });
  }

  private async runScheduleIfDue(
    state: OfficeState,
    emit: (e: OfficeEvent) => void,
  ): Promise<boolean> {
    const hit = dueSchedule(state);
    if (!hit) return false;
    markFired(state, hit.id);
    if (hit.id === "login") applyLogin(state, emit);
    if (hit.id === "standup") applyStandup(state, emit);
    if (hit.id === "lunch") applyLunch(state, emit);
    if (hit.id === "wrap") applyWrap(state, emit);
    return true;
  }

  private async apply(op: WorkOp, state: OfficeState, emit: (e: OfficeEvent) => void): Promise<void> {
    const time = formatClock(state.clock);
    switch (op.t) {
      case "say":
        rememberShort(state.shortTerm, op.agent, `Said: ${op.text}`, time);
        emit({ type: "say", agentId: op.agent, text: op.text });
        emit({ type: "status", agentId: op.agent, status: `talking: ${op.text.slice(0, 72)}` });
        break;
      case "cooler": {
        const post = { id: crypto.randomUUID(), from: op.agent, text: op.text, time };
        state.watercooler.push(post);
        rememberShort(state.shortTerm, op.agent, `Watercooler: ${op.text}`, time, "gossip");
        await this.memory.remember({ agentId: op.agent, kind: "gossip", text: op.text, time });
        emit({ type: "watercooler", ...post });
        emit({ type: "say", agentId: op.agent, text: op.text });
        emit({ type: "status", agentId: op.agent, status: "at the watercooler" });
        break;
      }
      case "dm": {
        state.mailboxes[op.to].push({
          id: crypto.randomUUID(),
          from: op.from,
          to: op.to,
          text: op.text,
          time,
        });
        rememberShort(state.shortTerm, op.from, `DM to ${op.to}: ${op.text}`, time);
        rememberShort(state.shortTerm, op.to, `DM from ${op.from}: ${op.text}`, time);
        emit({ type: "dm", from: op.from, to: op.to, text: op.text });
        emit({
          type: "whisper",
          agentId: op.from,
          text: `→ ${workerById(op.to).name}: ${op.text}`,
        });
        emit({ type: "status", agentId: op.from, status: `DMing ${workerById(op.to).name}` });
        break;
      }
      case "move":
        state.positions[op.agent] = op.zone;
        emit({ type: "move_to", agentId: op.agent, zone: op.zone });
        emit({
          type: "status",
          agentId: op.agent,
          status: `walking to ${op.zone.replaceAll("_", " ")}`,
        });
        break;
      case "task": {
        const task = state.tasks.find((t) => t.id === op.id);
        if (!task) break;
        task.status = op.status;
        task.note = op.note;
        syncTicket(state, task);
        emit({ type: "task_update", task: { ...task } });
        emit({
          type: "queue_update",
          agentId: task.owner,
          queue: state.queues[task.owner].map((t) => ({ ...t })),
        });
        break;
      }
      case "create": {
        const ticket = {
          id: op.id,
          title: op.title,
          owner: op.owner,
          reporter: "angela" as const,
          status: "todo" as const,
          note: op.note,
          kind: "company" as const,
        };
        syncTicket(state, ticket);
        emit({ type: "task_update", task: { ...ticket } });
        emit({
          type: "queue_update",
          agentId: ticket.owner,
          queue: state.queues[ticket.owner].map((t) => ({ ...t })),
        });
        emit({ type: "status", agentId: op.owner, status: `opened ${op.id}` });
        break;
      }
      case "remember":
        await this.memory.remember({ agentId: op.agent, kind: op.kind, text: op.text, time });
        break;
      case "status":
        emit({ type: "status", agentId: op.agent, status: op.status });
        break;
    }
  }
}
