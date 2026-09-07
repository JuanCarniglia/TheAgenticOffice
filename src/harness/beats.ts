import { goalReached, type AgentId, type OfficeEvent, type ZoneId } from "../shared/types.js";
import { workerById } from "../shared/roster.js";
import { findSku, restockToStart } from "../shared/commerce.js";
import { skuLabel } from "../shared/catalog.js";
import { rememberShort } from "./memory.js";
import { formatClock } from "../shared/clock.js";
import type { OfficeState } from "./officeState.js";
import type { StockSku } from "../shared/catalog.js";
import { deliverCallLine, hangupLine, pamAckAndTransferLine, pamPickupLine, salesHello } from "./salesScript.js";

export type FloorBeat =
  | { t: "move"; agent: AgentId; zone: ZoneId }
  | { t: "say"; agent: AgentId; text: string }
  | { t: "whisper"; agent: AgentId; text: string }
  | { t: "status"; agent: AgentId; status: string }
  | { t: "pitch"; agent: AgentId; text: string }
  | { t: "phone"; kind: "ring" | "pickup" | "transfer" | "hangup" }
  | { t: "call"; agent: AgentId; text: string }
  | { t: "call_live"; agent: AgentId }
  | { t: "bell" }
  | { t: "review" }
  | { t: "fire"; zone: ZoneId; on: boolean }
  | { t: "reorder"; skuId: string };

const WHAZUP_EVERY = 140;

export function queueSaleCelebration(
  state: OfficeState,
  salesperson: AgentId,
  revenue: number,
): void {
  const name = workerById(salesperson).name;
  const desk: ZoneId = salesperson === "dwight" ? "bullpen_dwight" : "bullpen_sales";
  state.beats.push(
    { t: "move", agent: "michael", zone: desk },
    { t: "status", agent: "michael", status: `congratulating ${name}` },
    {
      t: "say",
      agent: "michael",
      text: `YES! ${name}! That's a close! That's what I'm talking about!`,
    },
    {
      t: "say",
      agent: salesperson,
      text:
        salesperson === "dwight"
          ? "Thank you. I executed the sale correctly."
          : "Appreciate it, Mike.",
    },
  );
  if (revenue >= 100) {
    state.beats.push(
      { t: "bell" },
      { t: "status", agent: "pam", status: "ringing the sales bell" },
      {
        t: "say",
        agent: "pam",
        text: "*ding-ding* Hundred-dollar bell. Nice one.",
      },
    );
  }
  state.beats.push({ t: "move", agent: "michael", zone: "manager_office" });
  if (!state.goalMet && goalReached(state.goal, state.todayEarnings)) {
    state.beats.push({ t: "review" });
  }
}

const SHIP_DELAY_TICKS = 36;

export function queueReorderAsk(state: OfficeState, sku: StockSku): void {
  const need = Math.max(0, sku.startQty - sku.qty);
  if (!need) return;
  if (state.shipments.some((s) => s.skuId === sku.id)) return;
  const label = skuLabel(sku);
  sku.incoming = need;
  state.shipments.push({ skuId: sku.id, arriveTick: state.tick + SHIP_DELAY_TICKS });
  state.beats.push(
    { t: "move", agent: "angela", zone: "reception" },
    { t: "status", agent: "angela", status: "asking Pam to reorder" },
    {
      t: "say",
      agent: "angela",
      text: `Pam. ${label} is at ${sku.qty} ${sku.unit}. Reorder ${need} to fill the cage.`,
    },
    {
      t: "say",
      agent: "pam",
      text: `On it. ${need} ${sku.unit} of ${label} — mill truck later. Cage stays short till then.`,
    },
    { t: "move", agent: "angela", zone: "accounting" },
  );
}

export function maybeDeliverShipments(state: OfficeState): void {
  if (state.meeting || state.beats.length) return;
  const ready = state.shipments.filter((s) => state.tick >= s.arriveTick);
  if (!ready.length) return;
  state.shipments = state.shipments.filter((s) => state.tick < s.arriveTick);
  for (const s of ready) {
    const sku = findSku(state.stock, s.skuId);
    const label = sku ? skuLabel(sku) : "the paper";
    state.beats.push(
      { t: "status", agent: "pam", status: "mill truck at the dock" },
      { t: "say", agent: "pam", text: `Mill truck. ${label} is back in the cage.` },
      { t: "reorder", skuId: s.skuId },
    );
  }
}

export function maybeQueueWhazup(state: OfficeState): void {
  if (state.meeting || state.beats.length) return;
  if (state.callPhase === "ringing" || state.callPhase === "pam") return;
  if (state.tick < 80) return;
  if (state.tick - state.lastWhazupTick < WHAZUP_EVERY) return;
  state.lastWhazupTick = state.tick;
  state.beats.push(
    { t: "move", agent: "michael", zone: "water_cooler" },
    { t: "status", agent: "michael", status: "yelling across the floor" },
    { t: "say", agent: "michael", text: "WHAZUUUPP!!!" },
    { t: "say", agent: "dwight", text: "Whatzup." },
    { t: "say", agent: "jim", text: "*sigh*" },
    { t: "move", agent: "michael", zone: "manager_office" },
  );
}

const AMBIENT_EVERY = 48;
const FAX_EVERY = 180;
const FIRE_ZONES: ZoneId[] = ["kitchen", "annex", "water_cooler", "breakroom", "accounting"];

type AmbientKind = "fire" | "fax" | "cats" | "coffee" | "boom";

const AMBIENT: Array<{ kind: AmbientKind; w: number }> = [
  { kind: "fire", w: 3 },
  { kind: "fax", w: 1 },
  { kind: "cats", w: 1 },
  { kind: "coffee", w: 3 },
  { kind: "boom", w: 2 },
];

function pickAmbient(exclude: string): AmbientKind {
  const pool = AMBIENT.filter((a) => a.kind !== exclude);
  const total = pool.reduce((n, a) => n + a.w, 0);
  let roll = Math.random() * total;
  for (const a of pool) {
    roll -= a.w;
    if (roll <= 0) return a.kind;
  }
  return pool[0]!.kind;
}

function queueFire(state: OfficeState): void {
  const zone = FIRE_ZONES[Math.floor(Math.random() * FIRE_ZONES.length)]!;
  state.beats.push(
    { t: "fire", zone, on: true },
    { t: "status", agent: "dwight", status: "sprinting to a fire" },
    { t: "move", agent: "dwight", zone },
    { t: "say", agent: "dwight", text: "Not a drill! Be professional, people!" },
    { t: "status", agent: "dwight", status: "putting out the fire" },
    { t: "fire", zone, on: false },
    { t: "say", agent: "dwight", text: "Contained. As I planned." },
    { t: "move", agent: "dwight", zone: "bullpen_dwight" },
  );
}

function queueFax(state: OfficeState): void {
  state.beats.push(
    { t: "status", agent: "pam", status: "fax from corporate" },
    { t: "say", agent: "pam", text: "Fax from corporate." },
    { t: "move", agent: "pam", zone: "manager_office" },
    { t: "say", agent: "michael", text: "Put it in the special cabinet." },
    { t: "say", agent: "michael", text: "*throws it in the trash* Heh heh." },
    { t: "move", agent: "pam", zone: "reception" },
  );
}

function queueCats(state: OfficeState): void {
  state.beats.push(
    { t: "status", agent: "angela", status: "thinking about her cats" },
    { t: "whisper", agent: "angela", text: "What might my cats be doing now?" },
  );
}

function queueCoffee(state: OfficeState): void {
  state.beats.push(
    { t: "status", agent: "jim", status: "sneaking a coffee" },
    { t: "status", agent: "pam", status: "sneaking a coffee" },
    { t: "move", agent: "jim", zone: "kitchen" },
    { t: "move", agent: "pam", zone: "kitchen" },
    { t: "say", agent: "jim", text: "..." },
    { t: "say", agent: "pam", text: "..." },
    { t: "move", agent: "jim", zone: "bullpen_sales" },
    { t: "move", agent: "pam", zone: "reception" },
  );
}

function queueBoom(state: OfficeState): void {
  state.beats.push(
    { t: "status", agent: "dwight", status: "performing" },
    { t: "say", agent: "dwight", text: "Boom Bam Boom, tatata boom" },
  );
}

export function maybeQueueAmbient(state: OfficeState): void {
  if (state.meeting || state.beats.length) return;
  if (state.callPhase === "ringing" || state.callPhase === "pam") return;
  if (state.tick < 50) return;
  if (state.tick - state.lastAmbientTick < AMBIENT_EVERY) return;
  let kind = pickAmbient(state.lastAmbientKind);
  if (kind === "fax" && state.tick - state.lastFaxTick < FAX_EVERY) {
    kind = pickAmbient("fax");
  }
  if (kind === "coffee" && state.pendingCustomer?.agentId === "jim") {
    kind = pickAmbient("coffee");
  }
  state.lastAmbientTick = state.tick;
  state.lastAmbientKind = kind;
  if (kind === "fire") queueFire(state);
  if (kind === "fax") {
    state.lastFaxTick = state.tick;
    queueFax(state);
  }
  if (kind === "cats") queueCats(state);
  if (kind === "coffee") queueCoffee(state);
  if (kind === "boom") queueBoom(state);
}

export function queueInboundCall(state: OfficeState, to: AgentId): boolean {
  if (to !== "jim" && to !== "dwight") return false;
  if (state.meeting) return false;
  if (state.callPhase === "ringing" || state.callPhase === "pam") return false;
  if (state.callPhase === "live" && state.callTarget === to) return false;
  if (state.callPhase === "live") {
    queueTransferCall(state, to);
    return true;
  }
  state.callPhase = "ringing";
  state.callTarget = to;
  state.outreachLead = to;
  state.beats.push(
    { t: "phone", kind: "ring" },
    { t: "status", agent: "pam", status: "phone ringing" },
    { t: "say", agent: "pam", text: "I'll get it." },
    { t: "phone", kind: "pickup" },
    { t: "status", agent: "pam", status: "on the line" },
    { t: "call", agent: "pam", text: pamPickupLine() },
  );
  return true;
}

/** After the caller answers Pam, she acknowledges and transfers. */
export function handlePamCallerReply(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  text: string,
): void {
  if (state.callPhase !== "pam") return;
  const to = state.callTarget === "dwight" ? "dwight" : "jim";
  deliverCallLine(state, emit, "pam", pamAckAndTransferLine(text, to));
  queueTransferCall(state, to, true);
}

const PHONE_BEATS = new Set<FloorBeat["t"]>(["phone", "call", "call_live", "pitch"]);

export function hangUpCall(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  from?: AgentId,
): boolean {
  if (state.callPhase === "idle" && !state.pendingCustomer) return false;
  const speaker: AgentId =
    from === "pam" || from === "jim" || from === "dwight"
      ? from
      : state.callPhase === "pam" || state.callPhase === "ringing"
        ? "pam"
        : state.callTarget === "dwight"
          ? "dwight"
          : "jim";
  state.beats = state.beats.filter((b) => !PHONE_BEATS.has(b.t));
  state.callPhase = "idle";
  state.pendingCustomer = null;
  state.lastCustomerText = "";
  state.lastCustomerTo = null;
  deliverCallLine(state, emit, speaker, hangupLine(speaker), { wait: false });
  emit({ type: "status", agentId: speaker, status: "hung up — back at the desk" });
  emit({ type: "phone", kind: "hangup" });
  return true;
}

export function queueTransferCall(state: OfficeState, to: AgentId, alreadyOnLine = false): void {
  if (to !== "jim" && to !== "dwight") return;
  state.callPhase = "pam";
  state.callTarget = to;
  state.outreachLead = to;
  const name = to === "jim" ? "Jim" : "Dwight";
  const beats: FloorBeat[] = [
    { t: "say", agent: "pam", text: `Transferring line one to ${name}.` },
    { t: "phone", kind: "transfer" },
    { t: "status", agent: to, status: "picking up the transfer" },
    { t: "call", agent: to, text: salesHello(state, to) },
    { t: "call_live", agent: to },
  ];
  if (!alreadyOnLine) {
    beats.unshift({ t: "call", agent: "pam", text: `One sec, I've got ${name} for you.` });
  }
  state.beats.unshift(...beats);
}

export function maybeQueueFloorBits(state: OfficeState): void {
  maybeDeliverShipments(state);
  maybeQueueWhazup(state);
  if (!state.beats.length) maybeQueueAmbient(state);
}

export function applyBeat(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  beat: FloorBeat,
): void {
  const time = formatClock(state.clock);
  switch (beat.t) {
    case "move":
      state.positions[beat.agent] = beat.zone;
      emit({ type: "move_to", agentId: beat.agent, zone: beat.zone });
      emit({
        type: "status",
        agentId: beat.agent,
        status: `walking to ${beat.zone.replaceAll("_", " ")}`,
      });
      break;
    case "say":
      rememberShort(state.shortTerm, beat.agent, `Said: ${beat.text}`, time);
      emit({ type: "say", agentId: beat.agent, text: beat.text });
      emit({ type: "status", agentId: beat.agent, status: `talking: ${beat.text.slice(0, 72)}` });
      break;
    case "pitch": {
      const text = beat.text || salesHello(state, beat.agent);
      deliverCallLine(state, emit, beat.agent, text);
      emit({ type: "status", agentId: beat.agent, status: "on the phone" });
      break;
    }
    case "phone":
      emit({ type: "phone", kind: beat.kind });
      break;
    case "call":
      if (beat.agent === "pam") state.callPhase = "pam";
      else {
        state.callTarget = beat.agent;
        state.outreachLead = beat.agent;
      }
      deliverCallLine(state, emit, beat.agent, beat.text);
      emit({ type: "status", agentId: beat.agent, status: "on the phone" });
      break;
    case "call_live":
      state.callPhase = "live";
      state.callTarget = beat.agent;
      state.outreachLead = beat.agent;
      break;
    case "whisper":
      rememberShort(state.shortTerm, beat.agent, `Aside: ${beat.text}`, time);
      emit({ type: "whisper", agentId: beat.agent, text: beat.text });
      emit({ type: "status", agentId: beat.agent, status: `to herself: ${beat.text}` });
      break;
    case "fire":
      emit({ type: "fire", zone: beat.zone, on: beat.on });
      break;
    case "status":
      emit({ type: "status", agentId: beat.agent, status: beat.status });
      break;
    case "bell":
      emit({ type: "bell" });
      break;
    case "review":
      if (!state.goalMet) {
        state.goalMet = true;
        emit({ type: "goal_met" });
      }
      break;
    case "reorder": {
      const sku = findSku(state.stock, beat.skuId);
      if (!sku) break;
      const { qty, cost } = restockToStart(sku);
      state.balance = Math.round((state.balance - cost) * 100) / 100;
      emit({
        type: "reordered",
        skuId: sku.id,
        label: skuLabel(sku),
        qty,
        unit: sku.unit,
        cost,
      });
      emit({
        type: "books",
        balance: state.balance,
        todayEarnings: state.todayEarnings,
        todayTokens: state.todayTokens,
      });
      emit({ type: "stock", items: state.stock.map((s) => ({ ...s })) });
      break;
    }
  }
}

export function drainBeat(state: OfficeState, emit: (e: OfficeEvent) => void): boolean {
  if (state.meeting || !state.beats.length) return false;
  const beat = state.beats.shift()!;
  applyBeat(state, emit, beat);
  return true;
}
