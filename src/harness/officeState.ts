import {
  type AgentId,
  type DirectMessage,
  type Meeting,
  type OfficeEvent,
  type Provider,
  type SessionConfig,
  type SimSpeed,
  type Ticket,
  type WatercoolerPost,
  type ZoneId,
} from "../shared/types.js";
import { AGENT_IDS, looksLikeFirmOrder, looksLikePurchase } from "../shared/roster.js";
import { formatClock, startOfWeek } from "../shared/clock.js";
import {
  formatMoney,
  formatTokenCost,
  seedStock,
  skuLabel,
  STARTING_BALANCE,
  tokenSpendUsd,
  type StockSku,
} from "../shared/catalog.js";
import { matchSkuFromText, mentionsPaperSpec, qtyFromText, ringUp } from "../shared/commerce.js";
import { officeLog } from "../shared/trace.js";
import { emptyQueues, emptyShortTerm, type ShortTerm } from "./memory.js";
import { queueReorderAsk, queueSaleCelebration, type FloorBeat } from "./beats.js";
import { deliverSalesLine, saleThanks } from "./salesScript.js";

export interface PendingHuman {
  agentId: AgentId;
  requestId: string;
  question: string;
}

export interface CustomerLine {
  from: AgentId | "you";
  to: AgentId | "you";
  text: string;
  time: string;
}

export interface OfficeState {
  goal: string;
  provider: Provider;
  model: string;
  speed: SimSpeed;
  tasks: Ticket[];
  queues: Record<AgentId, Ticket[]>;
  mailboxes: Record<AgentId, DirectMessage[]>;
  shortTerm: ShortTerm;
  watercooler: WatercoolerPost[];
  meeting: Meeting | null;
  positions: Record<AgentId, ZoneId>;
  pendingHuman: PendingHuman | null;
  pendingCustomer: PendingHuman | null;
  customerLog: CustomerLine[];
  clock: { day: number; minutes: number };
  firedSchedule: string[];
  tick: number;
  goalMet: boolean;
  busy: boolean;
  balance: number;
  todayEarnings: number;
  todayTokens: number;
  stock: StockSku[];
  lastPitchSkuId: string;
  lastPitchQty: number;
  outreachLead: AgentId;
  lastCustomerTo: AgentId | null;
  lastCustomerText: string;
  salesTurns: number;
  beats: FloorBeat[];
  lastWhazupTick: number;
  lastAmbientTick: number;
  lastAmbientKind: string;
  lastFaxTick: number;
  tokenCapNotified: boolean;
  shipments: Array<{ skuId: string; arriveTick: number }>;
  callPhase: "idle" | "ringing" | "pam" | "live";
  callTarget: AgentId;
}

export function emptyState(config: SessionConfig): OfficeState {
  return {
    goal: config.goal,
    provider: config.provider,
    model: config.model,
    speed: config.speed,
    tasks: [],
    queues: emptyQueues(),
    mailboxes: {
      michael: [],
      pam: [],
      jim: [],
      dwight: [],
      angela: [],
    },
    shortTerm: emptyShortTerm(),
    watercooler: [],
    meeting: null,
    positions: {
      michael: "manager_office",
      pam: "reception",
      jim: "bullpen_sales",
      dwight: "bullpen_dwight",
      angela: "accounting",
    },
    pendingHuman: null,
    pendingCustomer: null,
    customerLog: [],
    clock: startOfWeek(),
    firedSchedule: [],
    tick: 0,
    goalMet: false,
    busy: false,
    balance: STARTING_BALANCE,
    todayEarnings: 0,
    todayTokens: 0,
    stock: seedStock(),
    lastPitchSkuId: "copy-a3-80",
    lastPitchQty: 30,
    outreachLead: "jim",
    lastCustomerTo: null,
    lastCustomerText: "",
    salesTurns: 0,
    beats: [],
    lastWhazupTick: 0,
    lastAmbientTick: 0,
    lastAmbientKind: "",
    lastFaxTick: 0,
    tokenCapNotified: false,
    shipments: [],
    callPhase: "idle",
    callTarget: "jim",
  };
}

export function snapshot(state: OfficeState) {
  return {
    goal: state.goal,
    provider: state.provider,
    model: state.model,
    tasks: state.tasks,
    queues: state.queues,
    positions: state.positions,
    watercooler: state.watercooler.slice(-8),
    meeting: state.meeting,
    clock: formatClock(state.clock),
    pendingCustomer: state.pendingCustomer,
    customerLog: state.customerLog.slice(-20),
    tick: state.tick,
    goalMet: state.goalMet,
    balance: state.balance,
    todayEarnings: state.todayEarnings,
    todayTokens: state.todayTokens,
    stock: state.stock.map((s) => ({ ...s })),
  };
}

export function queuesCopy(state: OfficeState): Record<AgentId, Ticket[]> {
  return {
    michael: state.queues.michael.map((t) => ({ ...t })),
    pam: state.queues.pam.map((t) => ({ ...t })),
    jim: state.queues.jim.map((t) => ({ ...t })),
    dwight: state.queues.dwight.map((t) => ({ ...t })),
    angela: state.queues.angela.map((t) => ({ ...t })),
  };
}

export function sessionStartedEvent(state: OfficeState): OfficeEvent {
  return {
    type: "session_started",
    goal: state.goal,
    tasks: state.tasks.map((t) => ({ ...t })),
    positions: { ...state.positions },
    clock: formatClock(state.clock),
    queues: queuesCopy(state),
    balance: state.balance,
    todayEarnings: state.todayEarnings,
    todayTokens: state.todayTokens,
    stock: state.stock.map((s) => ({ ...s })),
  };
}

export function emitBooks(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  emit({
    type: "books",
    balance: state.balance,
    todayEarnings: state.todayEarnings,
    todayTokens: state.todayTokens,
  });
}

export function recordTokens(state: OfficeState, tokens: number, emit: (e: OfficeEvent) => void): void {
  const n = Math.max(0, Math.round(tokens));
  if (!n) return;
  state.todayTokens += n;
  officeLog(
    "tokens",
    `+${n}`,
    `day ${state.todayTokens}`,
    formatTokenCost(tokenSpendUsd(state.todayTokens)),
  );
  emitBooks(state, emit);
}

export function applySale(
  state: OfficeState,
  skuId: string,
  qty: number,
  salesperson: AgentId,
  emit: (e: OfficeEvent) => void,
) {
  const result = ringUp(state.stock, skuId, qty);
  if (!result.ok || !result.sku || result.revenue == null || result.qty == null) {
    return result;
  }
  state.balance = Math.round((state.balance + result.revenue) * 100) / 100;
  state.todayEarnings = Math.round((state.todayEarnings + result.revenue) * 100) / 100;
  emit({
    type: "sale",
    skuId: result.sku.id,
    label: skuLabel(result.sku),
    qty: result.qty,
    unit: result.sku.unit,
    revenue: result.revenue,
    salesperson,
  });
  emitBooks(state, emit);
  emit({ type: "stock", items: state.stock.map((s) => ({ ...s })) });
  if (result.hitReorder) {
    emit({
      type: "reorder_alert",
      skuId: result.sku.id,
      label: skuLabel(result.sku),
      qty: result.sku.qty,
      reorderAt: result.sku.reorderAt,
      unit: result.sku.unit,
    });
  }
  queueSaleCelebration(state, salesperson, result.revenue);
  if (result.hitReorder) queueReorderAsk(state, result.sku);
  emit({ type: "stock", items: state.stock.map((s) => ({ ...s })) });
  markClosedSaleTickets(state, emit, result.sku, result.qty);
  return result;
}

export function rememberDealFromText(state: OfficeState, text: string): void {
  const matched = matchSkuFromText(state.stock, text);
  if (matched) state.lastPitchSkuId = matched.id;
  const withUnit = text.match(/\b(\d{1,3})\s*(reams?|packs?|units?)\b/i);
  if (withUnit) {
    const n = Number(withUnit[1]);
    if (Number.isFinite(n) && n >= 1) state.lastPitchQty = Math.min(n, 200);
  }
}

function isCounterSpec(state: OfficeState, text: string): boolean {
  if (!mentionsPaperSpec(text)) return false;
  const matched = matchSkuFromText(state.stock, text);
  if (matched) return matched.id !== state.lastPitchSkuId;
  return true;
}

export function dealIsQuoted(state: OfficeState): boolean {
  return state.customerLog.slice(-12).some((l) => {
    if (l.from !== "jim" && l.from !== "dwight") return false;
    return /\$\d|\bprice\b|\beach\b|\bper ream\b|\bper pack\b|\breams?\b|\bgsm\b|\ba3\b|\ba4\b|\bwrite it up\b|\bhold them\b|\bcopy paper\b/i.test(
      l.text,
    );
  });
}

/** Ring up from the caller's line. Chat agreement is not a sale until this runs. */
export function tryCloseSale(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  salesperson: AgentId,
  text: string,
): boolean {
  const counter = isCounterSpec(state, text);
  rememberDealFromText(state, text);
  if (counter && !looksLikeFirmOrder(text)) return false;
  if (!looksLikePurchase(text, dealIsQuoted(state))) return false;
  if (mentionsPaperSpec(text) && !matchSkuFromText(state.stock, text) && !looksLikeFirmOrder(text)) {
    return false;
  }
  const matched = matchSkuFromText(state.stock, text);
  const skuId = matched?.id ?? state.lastPitchSkuId;
  const qty = qtyFromText(text, state.lastPitchQty);
  const sold = applySale(state, skuId, qty, salesperson, emit);
  deliverSalesLine(
    state,
    emit,
    salesperson,
    sold.ok ? saleThanks(state) : sold.message,
  );
  return true;
}

function markClosedSaleTickets(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  sku: StockSku,
  qty: number,
): void {
  const notes: Array<[string, string]> = [
    ["AO-3", `Sold ${qty} ${sku.unit} of ${skuLabel(sku)}`],
    ["AO-4", "Logged the order"],
    ["AO-2", "Price held"],
    ["AO-5", "Backup not needed"],
  ];
  for (const [id, note] of notes) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) continue;
    task.status = "done";
    task.note = note;
    syncTicket(state, task);
    emit({ type: "task_update", task: { ...task } });
  }
}

export function defaultBoard(): Ticket[] {
  return [
    {
      id: "AO-1",
      title: "Name the week's sale",
      owner: "michael",
      reporter: "supervisor",
      status: "todo",
      note: "CEO mandate",
      kind: "company",
    },
    {
      id: "AO-2",
      title: "Price the inbound call",
      owner: "angela",
      reporter: "supervisor",
      status: "todo",
      note: "PM owns the sheet",
      kind: "company",
    },
    {
      id: "AO-3",
      title: "Close the inbound call",
      owner: "jim",
      reporter: "supervisor",
      status: "todo",
      note: "Jim + Dwight, phone only",
      kind: "company",
    },
    {
      id: "AO-4",
      title: "Answer and transfer the call",
      owner: "pam",
      reporter: "supervisor",
      status: "todo",
      note: "Reception picks up first",
      kind: "company",
    },
    {
      id: "AO-5",
      title: "Backup close if Jim stalls",
      owner: "dwight",
      reporter: "supervisor",
      status: "todo",
      note: "Facts. Volume. No jokes.",
      kind: "company",
    },
  ];
}

export function seedQueues(state: OfficeState): void {
  for (const ticket of state.tasks) {
    if (!state.queues[ticket.owner].some((t) => t.id === ticket.id)) {
      state.queues[ticket.owner].push({ ...ticket });
    }
  }
}

export function allTasksDone(state: OfficeState): boolean {
  return state.tasks.length > 0 && state.tasks.every((t) => t.status === "done");
}

export function syncTicket(state: OfficeState, ticket: Ticket): void {
  const i = state.tasks.findIndex((t) => t.id === ticket.id);
  if (i >= 0) state.tasks[i] = ticket;
  else state.tasks.push(ticket);
  const q = state.queues[ticket.owner];
  const qi = q.findIndex((t) => t.id === ticket.id);
  if (qi >= 0) q[qi] = { ...ticket };
  else q.push({ ...ticket });
}

export function formatBlackboard(state: OfficeState): string {
  const tasks = state.tasks
    .map((t) => `- [${t.status}] ${t.id} ${t.title} (@${t.owner}) — ${t.note}`)
    .join("\n");
  const queues = AGENT_IDS.map((id) => {
    const items = state.queues[id];
    if (!items.length) return `- ${id}: (empty)`;
    return `- ${id}: ${items.map((t) => `${t.id}:${t.status}`).join(", ")}`;
  }).join("\n");
  const cooler = state.watercooler
    .slice(-5)
    .map((p) => `- [${p.time}] ${p.from}: ${p.text}`)
    .join("\n");
  const dms = AGENT_IDS.map((id) => {
    const notes = state.mailboxes[id].slice(-2);
    if (!notes.length) return `- ${id}: (none)`;
    return `- ${id}: ${notes.map((n) => `${n.from}> ${n.text}`).join(" | ")}`;
  }).join("\n");
  const pos = AGENT_IDS.map((id) => `- ${id}: ${state.positions[id]}`).join("\n");
  const meeting = state.meeting
    ? `${state.meeting.title} — ${state.meeting.topic} (${state.meeting.remainingTurns} turns left)`
    : "none";
  const stockLines = state.stock
    .map((s) => {
      const flag = s.qty <= s.reorderAt ? " LOW" : "";
      return `- ${s.id} ${skuLabel(s)}: ${s.qty}/${s.startQty} ${s.unit} (reorder ${s.reorderAt})${flag}  ${formatMoney(s.price)}`;
    })
    .join("\n");
  return [
    `Office time: ${formatClock(state.clock)}  (tick ${state.tick})`,
    `Goal: ${state.goal}`,
    `Goal met: ${state.goalMet}`,
    `Books: balance ${formatMoney(state.balance)}  ·  today ${formatMoney(state.todayEarnings)}  ·  tokens ${state.todayTokens} (${formatTokenCost(tokenSpendUsd(state.todayTokens))})`,
    `Meeting: ${meeting}`,
    `Jira board:\n${tasks || "(empty)"}`,
    `Personal queues:\n${queues}`,
    `Watercooler:\n${cooler || "(quiet)"}`,
    `DMs:\n${dms}`,
    `Positions:\n${pos}`,
    `Warehouse:\n${stockLines}`,
    `Last pitch: ${state.lastPitchQty} of ${state.lastPitchSkuId} by ${state.outreachLead}`,
    state.lastCustomerText
      ? `Customer just wrote to ${state.lastCustomerTo}: "${state.lastCustomerText}" — that salesperson must answer with a NEW chat line. Do not restart the opening pitch. Do not switch salespeople.`
      : "",
    `Customer chat:\n${
      state.customerLog
        .slice(-6)
        .map((l) => `- [${l.time}] ${l.from} → ${l.to}: ${l.text}`)
        .join("\n") || "(empty)"
    }`,
    state.pendingCustomer
      ? `Waiting on the customer to reply to ${state.pendingCustomer.agentId}: ${state.pendingCustomer.question}`
      : "No open customer pitch.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Compact board for live LLM ticks — skip quiet queues, DMs, and full warehouse. */
export function formatSlimBoard(state: OfficeState): string {
  const low = state.stock
    .filter((s) => s.qty <= s.reorderAt)
    .map((s) => `- ${s.id} ${skuLabel(s)}: ${s.qty} ${s.unit} ${formatMoney(s.price)} LOW`)
    .join("\n");
  const sku = state.stock.find((s) => s.id === state.lastPitchSkuId);
  const chat = state.customerLog
    .slice(-4)
    .map((l) => `- ${l.from} → ${l.to}: ${l.text}`)
    .join("\n");
  return [
    `Time ${formatClock(state.clock)}  books ${formatMoney(state.balance)}`,
    `If they ask for paper: ${state.lastPitchQty} of ${sku ? skuLabel(sku) : state.lastPitchSkuId} at ${sku ? formatMoney(sku.price) : "?"}. Do not recite this unless they asked.`,
    low ? `Low stock:\n${low}` : "Warehouse: no LOW lines.",
    `Chat:\n${chat || "(empty)"}`,
    state.lastCustomerText
      ? `Customer just wrote to ${state.lastCustomerTo}: "${state.lastCustomerText}"`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
