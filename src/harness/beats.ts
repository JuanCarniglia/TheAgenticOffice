import { goalReached, type AgentId, type OfficeEvent, type ZoneId } from "../shared/types.js";
import { linePlayMs } from "../shared/speech.js";
import { workerById } from "../shared/roster.js";
import { findSku, restockToStart } from "../shared/commerce.js";
import { skuLabel } from "../shared/catalog.js";
import { rememberShort } from "./memory.js";
import { formatClock } from "../shared/clock.js";
import { isSalesCallActive, recordTokens, type OfficeState } from "./officeState.js";
import { performLine } from "./voice.js";
import type { StockSku } from "../shared/catalog.js";
import { deliverCallLine, hangupLine, pamAckAndTransferLine, pamPickupLine, salesHello } from "./salesScript.js";

type BeatBody =
  | { t: "move"; agent: AgentId; zone: ZoneId }
  | { t: "say"; agent: AgentId; text: string; cue?: string }
  | { t: "whisper"; agent: AgentId; text: string; cue?: string }
  | { t: "status"; agent: AgentId; status: string }
  | { t: "pitch"; agent: AgentId; text: string; cue?: string }
  | { t: "phone"; kind: "ring" | "pickup" | "transfer" | "hangup" }
  | { t: "call"; agent: AgentId; text: string; cue?: string }
  | { t: "call_live"; agent: AgentId }
  | { t: "bell" }
  | { t: "review" }
  | { t: "fire"; zone: ZoneId; on: boolean }
  | { t: "reorder"; skuId: string };

export type FloorBeat = BeatBody & { hold?: boolean };

function hold(beat: BeatBody): FloorBeat {
  return { ...beat, hold: true };
}

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
      cue: `Congratulate ${name} loudly for closing a paper sale. CEO pep-talk energy.`,
    },
    {
      t: "say",
      agent: salesperson,
      text:
        salesperson === "dwight"
          ? "Thank you. I executed the sale correctly."
          : "Appreciate it, Mike.",
      cue:
        salesperson === "dwight"
          ? "Accept Michael's congratulations in a stiff, literal way."
          : "Accept Michael's congratulations dryly, one short beat.",
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
        cue: "Ring the hundred-dollar sales bell and toss a warm one-liner.",
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
      cue: `Tell Pam to reorder ${need} ${sku.unit} of ${label} — we are at ${sku.qty}. Keep those numbers exact. Short and unimpressed.`,
    },
    {
      t: "say",
      agent: "pam",
      text: `On it. ${need} ${sku.unit} of ${label} — mill truck later. Cage stays short till then.`,
      cue: `Confirm you will reorder ${need} ${sku.unit} of ${label}. Mill truck later. Keep the numbers exact.`,
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
      {
        t: "say",
        agent: "pam",
        text: `Mill truck. ${label} is back in the cage.`,
        cue: `Announce the mill truck is here and ${label} is back in the cage.`,
      },
      { t: "reorder", skuId: s.skuId },
    );
  }
}

export function maybeQueueWhazup(state: OfficeState): void {
  if (state.meeting || state.beats.length) return;
  if (isSalesCallActive(state)) return;
  if (state.tick < 80) return;
  if (state.tick - state.lastWhazupTick < WHAZUP_EVERY) return;
  state.lastWhazupTick = state.tick;
  state.beats.push(
    hold({ t: "move", agent: "michael", zone: "water_cooler" }),
    hold({ t: "status", agent: "michael", status: "yelling across the floor" }),
    hold({
      t: "say",
      agent: "michael",
      text: "WHAZUUUPP!!!",
      cue: "Yell WHAZUUUP across the floor like a morning ritual. Big and silly.",
    }),
    hold({
      t: "say",
      agent: "dwight",
      text: "Whatzup.",
      cue: "Answer Michael's WHAZUUUP as a flat, literal Whatzup.",
    }),
    hold({
      t: "say",
      agent: "jim",
      text: "*sigh*",
      cue: "React to Michael's WHAZUUUP with a tiny tired sigh or dry aside. Almost nothing.",
    }),
    hold({ t: "move", agent: "michael", zone: "manager_office" }),
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
    hold({ t: "fire", zone, on: true }),
    hold({ t: "status", agent: "dwight", status: "sprinting to a fire" }),
    hold({ t: "move", agent: "dwight", zone }),
    hold({
      t: "say",
      agent: "dwight",
      text: "Not a drill! Be professional, people!",
      cue: "Announce a real fire, not a drill. Bark at people to be professional.",
    }),
    hold({ t: "status", agent: "dwight", status: "putting out the fire" }),
    hold({ t: "fire", zone, on: false }),
    hold({
      t: "say",
      agent: "dwight",
      text: "Contained. As I planned.",
      cue: "Announce the fire is contained. Credit your own planning.",
    }),
    hold({ t: "move", agent: "dwight", zone: "bullpen_dwight" }),
  );
}

function queueFax(state: OfficeState): void {
  state.beats.push(
    hold({ t: "status", agent: "pam", status: "fax from corporate" }),
    hold({
      t: "say",
      agent: "pam",
      text: "Fax from corporate.",
      cue: "Tell Michael a fax just came from corporate. Casual, a little weary.",
    }),
    hold({ t: "move", agent: "pam", zone: "manager_office" }),
    hold({
      t: "say",
      agent: "michael",
      text: "Put it in the special cabinet.",
      cue: "Tell Pam to put the corporate fax in the special cabinet. You do not mean that.",
    }),
    hold({
      t: "say",
      agent: "michael",
      text: "*throws it in the trash* Heh heh.",
      cue: "Throw the fax in the trash and chuckle. Stage direction plus a tiny laugh is fine.",
    }),
    hold({ t: "move", agent: "pam", zone: "reception" }),
  );
}

function queueCats(state: OfficeState): void {
  state.beats.push(
    hold({ t: "status", agent: "angela", status: "thinking about her cats" }),
    hold({
      t: "whisper",
      agent: "angela",
      text: "What might my cats be doing now?",
      cue: "A private aside about your cats. Soft, a little severe.",
    }),
  );
}

function queueCoffee(state: OfficeState): void {
  state.beats.push(
    hold({ t: "status", agent: "jim", status: "sneaking a coffee" }),
    hold({ t: "status", agent: "pam", status: "sneaking a coffee" }),
    hold({ t: "move", agent: "jim", zone: "kitchen" }),
    hold({ t: "move", agent: "pam", zone: "kitchen" }),
    hold({
      t: "say",
      agent: "jim",
      text: "...",
      cue: "Share a tiny kitchen look with Pam. Almost no words. Awkward and warm.",
    }),
    hold({
      t: "say",
      agent: "pam",
      text: "...",
      cue: "Answer Jim's kitchen look with almost nothing. A breath or a tiny smile in words.",
    }),
    hold({ t: "move", agent: "jim", zone: "bullpen_sales" }),
    hold({ t: "move", agent: "pam", zone: "reception" }),
  );
}

function queueBoom(state: OfficeState): void {
  state.beats.push(
    hold({ t: "status", agent: "dwight", status: "performing" }),
    hold({
      t: "say",
      agent: "dwight",
      text: "Boom Bam Boom, tatata boom",
      cue: "Perform a short ridiculous drum-mouth beat. Commit.",
    }),
  );
}

export function maybeQueueAmbient(state: OfficeState): void {
  if (state.meeting || state.beats.length) return;
  if (isSalesCallActive(state)) return;
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
    {
      t: "say",
      agent: "pam",
      text: "I'll get it.",
      cue: "The phone is ringing. Say you'll get it. Easy, reception-desk energy.",
    },
    { t: "phone", kind: "pickup" },
    { t: "status", agent: "pam", status: "on the line" },
    {
      t: "call",
      agent: "pam",
      text: pamPickupLine(),
      cue: "Answer the office phone. Say the company name, your name is Pam, and greet them gently. Ask how they are.",
    },
  );
  return true;
}

async function speak(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  agentId: AgentId,
  opts: { cue?: string; fallback: string; max?: number; strictFacts?: boolean },
): Promise<string> {
  return performLine({
    provider: state.provider,
    model: state.model,
    todayTokens: state.todayTokens,
    agentId,
    cue: opts.cue,
    fallback: opts.fallback,
    max: opts.max,
    strictFacts: opts.strictFacts,
    onTokens: (n) => recordTokens(state, n, emit),
  });
}

/** After the caller answers Pam, she acknowledges and transfers. */
export async function handlePamCallerReply(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  text: string,
): Promise<void> {
  if (state.callPhase !== "pam") return;
  const to = state.callTarget === "dwight" ? "dwight" : "jim";
  const name = to === "jim" ? "Jim" : "Dwight";
  const fallback = pamAckAndTransferLine(text, to);
  const line = await speak(state, emit, "pam", {
    cue: `The caller just said: "${text.slice(0, 120)}". Acknowledge them warmly and say you are transferring to ${name}. Stay on the line with them.`,
    fallback,
    max: 180,
  });
  deliverCallLine(state, emit, "pam", line);
  queueTransferCall(state, to, true);
}

const PHONE_BEATS = new Set<FloorBeat["t"]>(["phone", "call", "call_live", "pitch"]);

export function hangUpCall(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  from?: AgentId,
  opts?: { silent?: boolean },
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
  state.openQuote = false;
  state.callClosedSale = false;
  state.offeredOnHand = false;
  if (state.heldBeats.length) {
    state.beats.push(...state.heldBeats);
    state.heldBeats = [];
  }
  if (!opts?.silent) {
    deliverCallLine(state, emit, speaker, hangupLine(speaker), { wait: false });
  }
  emit({ type: "status", agentId: speaker, status: "hung up — back at the desk" });
  emit({ type: "phone", kind: "hangup" });
  return true;
}

/** Hang up after the last spoken line has time to type out in chat. */
export function hangUpAfterSpokenLine(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  from: AgentId | undefined,
  spoken: string,
  onDone?: () => void,
): void {
  const wait = linePlayMs(spoken);
  setTimeout(() => {
    if (state.callPhase !== "idle") {
      hangUpCall(state, emit, from, { silent: true });
    }
    onDone?.();
  }, wait);
}

export function queueTransferCall(state: OfficeState, to: AgentId, alreadyOnLine = false): void {
  if (to !== "jim" && to !== "dwight") return;
  state.callPhase = "pam";
  state.callTarget = to;
  state.outreachLead = to;
  const name = to === "jim" ? "Jim" : "Dwight";
  const beats: FloorBeat[] = [
    {
      t: "say",
      agent: "pam",
      text: `Transferring line one to ${name}.`,
      cue: `Tell the floor you are transferring line one to ${name}.`,
    },
    { t: "phone", kind: "transfer" },
    { t: "status", agent: to, status: "picking up the transfer" },
    {
      t: "call",
      agent: to,
      text: salesHello(state, to),
      cue:
        to === "dwight"
          ? "You just picked up a transferred call. Introduce yourself as Dwight, thank them for holding, and ask how their day is going. Formal, a little stiff."
          : "You just picked up a transferred call. Check they are still there, say you are Jim, and ask how their morning is going. Casual, human first.",
    },
    { t: "call_live", agent: to },
  ];
  if (!alreadyOnLine) {
    beats.unshift({
      t: "call",
      agent: "pam",
      text: `One sec, I've got ${name} for you.`,
      cue: `Tell the caller to hold one second — you have ${name} for them.`,
    });
  }
  state.beats.unshift(...beats);
}

export function maybeQueueFloorBits(state: OfficeState): void {
  maybeDeliverShipments(state);
  maybeQueueWhazup(state);
  if (!state.beats.length) maybeQueueAmbient(state);
}

export async function applyBeat(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  beat: FloorBeat,
): Promise<void> {
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
    case "say": {
      const text = await speak(state, emit, beat.agent, { cue: beat.cue, fallback: beat.text });
      rememberShort(state.shortTerm, beat.agent, `Said: ${text}`, time);
      emit({ type: "say", agentId: beat.agent, text });
      emit({ type: "status", agentId: beat.agent, status: `talking: ${text.slice(0, 72)}` });
      break;
    }
    case "pitch": {
      const fallback = beat.text || salesHello(state, beat.agent);
      const text = await speak(state, emit, beat.agent, {
        cue: beat.cue,
        fallback,
        max: 180,
      });
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
      {
        const spoken = await speak(state, emit, beat.agent, {
          cue: beat.cue,
          fallback: beat.text,
          max: 180,
        });
        deliverCallLine(state, emit, beat.agent, spoken);
      }
      emit({ type: "status", agentId: beat.agent, status: "on the phone" });
      break;
    case "call_live":
      state.callPhase = "live";
      state.callTarget = beat.agent;
      state.outreachLead = beat.agent;
      break;
    case "whisper": {
      const text = await speak(state, emit, beat.agent, { cue: beat.cue, fallback: beat.text });
      rememberShort(state.shortTerm, beat.agent, `Aside: ${text}`, time);
      emit({ type: "whisper", agentId: beat.agent, text });
      emit({ type: "status", agentId: beat.agent, status: `to herself: ${text}` });
      break;
    }
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

export async function drainBeat(state: OfficeState, emit: (e: OfficeEvent) => void): Promise<boolean> {
  if (state.meeting || !state.beats.length) return false;
  const beat = state.beats.shift()!;
  if (beat.hold && isSalesCallActive(state)) {
    state.heldBeats.push(beat);
    return true;
  }
  await applyBeat(state, emit, beat);
  return true;
}
