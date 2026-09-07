import type { AgentId, OfficeEvent } from "../shared/types.js";
import { looksLikeGreeting, looksLikeRejection, looksLikeSmallTalk, workerById } from "../shared/roster.js";
import { formatMoney, skuLabel } from "../shared/catalog.js";
import { findSku, interpretPaperAsk } from "../shared/commerce.js";
import { formatClock } from "../shared/clock.js";
import { rememberShort } from "./memory.js";
import type { OfficeState } from "./officeState.js";

const cache = new Map<string, string>();

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function skuLine(state: OfficeState): { label: string; qty: number; price: string; unit: string } {
  const sku = findSku(state.stock, state.lastPitchSkuId);
  return {
    label: sku ? skuLabel(sku) : "the paper",
    qty: state.lastPitchQty,
    price: sku ? formatMoney(sku.price) : "$8.50",
    unit: sku?.unit ?? "reams",
  };
}

export function pamPickupLine(): string {
  return "Agentic Office — Pam. Hi, how are you doing today?";
}

export function pamAckAndTransferLine(text: string, to: AgentId): string {
  const name = workerById(to).name;
  if (looksLikeGreeting(text) || /\b(good|fine|great|alright|not bad|okay|ok|pretty good)\b/i.test(text)) {
    return `Good — I'm glad. Hang on, I'll put ${name} on. One sec.`;
  }
  if (/\b(jim|dwight|sales|paper|order|buy)\b/i.test(text)) {
    return `Yep — I'll put you through to ${name}. Stay on.`;
  }
  return `Got it. Transferring you to ${name} now.`;
}

export function salesHello(state: OfficeState, to: AgentId): string {
  const name = workerById(to).name;
  if (to === "dwight") {
    return `This is ${name}. Thank you for holding. How is your day proceeding?`;
  }
  return `Hey, you still there? ${name}. How's your morning going?`;
}

export function openingPitch(state: OfficeState): string {
  return salesHello(state, state.outreachLead === "dwight" ? "dwight" : "jim");
}

function quoteChangedAsk(state: OfficeState, to: AgentId, text: string): string | null {
  const ask = interpretPaperAsk(state.stock, text);
  if (!ask) return null;
  const dwight = to === "dwight";
  if (!ask.sku) {
    if (ask.qty != null && !ask.note) {
      state.lastPitchQty = ask.qty;
      const { label, price, unit } = skuLine(state);
      return dwight
        ? `Quantity noted. ${ask.qty} ${unit} of ${label} at ${price} each. Shall I write it up?`
        : `Okay — ${ask.qty} ${unit} of ${label} at ${price} each. That work?`;
    }
    if (!ask.note) return null;
    return dwight
      ? "We do not carry that. Recycled is A4 80 gsm only. I can quote that if you wish."
      : "We don't have that cut. Recycled we only stock as A4 80 — want me to quote it?";
  }
  state.lastPitchSkuId = ask.sku.id;
  if (ask.qty != null) state.lastPitchQty = ask.qty;
  const qty = state.lastPitchQty;
  const price = formatMoney(ask.sku.price);
  const label = skuLabel(ask.sku);
  const caveat = ask.note ? `${ask.note} ` : "";
  return dwight
    ? `${caveat}I can do ${qty} ${ask.sku.unit} of ${label} at ${price} each. Shall I write it up?`
    : `${caveat}So that's ${qty} ${ask.sku.unit} of ${label} at ${price} each. Want that on the ticket?`;
}

function isFiller(text: string): boolean {
  return /^(ok|okay|sure|maybe|hmm|huh|what\??|yeah|yep|yup|uh huh|uhhuh|mm|mhm|right)$/i.test(text.trim());
}

function cacheableAsk(text: string): boolean {
  return !looksLikeSmallTalk(text) && !looksLikeGreeting(text) && !isFiller(text);
}

export function humanChatReply(to: AgentId, text: string, turn: number): string {
  const dwight = to === "dwight";
  if (/\bweather\b/i.test(text)) {
    return dwight
      ? "I do not control the weather. Inside, the HVAC is adequate. How are you?"
      : "Yeah, it's doing that thing weather does. You holding up okay?";
  }
  if (/\b(monday|tuesday|wednesday|thursday|friday|weekend)\b/i.test(text)) {
    return dwight
      ? "The calendar is correct. I prefer a structured week. How is yours going?"
      : "Tell me about it. Days blur in here. You hanging in?";
  }
  if (dwight) {
    const lines = [
      "I am well. Thank you. How is your day proceeding?",
      "Eight hours of sleep. The beets are thriving. And you?",
      "Small talk is permitted. I am fine. What brings you to this call?",
      "I remain on the line. You may continue.",
    ];
    return lines[Math.max(0, turn - 1) % lines.length]!;
  }
  const lines = [
    "I'm alright, yeah. You? Don't say 'fine' unless you mean it.",
    "Same old — coffee, fluorescent lights. How's your day treating you?",
    "Hanging in. We can talk paper whenever, or not. What's going on?",
    "Still here. What's on your mind?",
  ];
  return lines[Math.max(0, turn - 1) % lines.length]!;
}

export function cannedSalesReply(state: OfficeState, to: AgentId, text: string): string | null {
  const key = `${to}:${norm(text)}`;
  if (cacheableAsk(text)) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const { label, qty, price, unit } = skuLine(state);
  const dwight = to === "dwight";

  if (looksLikeRejection(text)) {
    return dwight
      ? "Understood. No pressure. The offer remains if you change your mind."
      : "Ha. Fair. I'll stop. Call back if you actually need paper — I'll be here.";
  }
  if (looksLikeSmallTalk(text) || looksLikeGreeting(text)) {
    return humanChatReply(to, text, state.salesTurns);
  }
  const spec = quoteChangedAsk(state, to, text);
  if (spec) return spec;
  if (/\b(how much|price|cost|each|per ream|per pack)\b/i.test(text)) {
    return dwight
      ? `Of course. ${label} is ${price} per ${unit.replace(/s$/, "")}. I can do ${qty} if that helps.`
      : `${label} runs ${price} each. I can put ${qty} ${unit} on a ticket if you want — no hard sell.`;
  }
  if (/\b(what|which|gsm|size|a3|a4|stock)\b/i.test(text) && text.length < 80) {
    return dwight
      ? `It is ${label}, ${qty} ${unit}, ${price}. 500 sheets to a ream. I can wait while you think.`
      : `We've got ${qty} ${unit} of ${label} sitting in the cage. ${price} each. Want me to hold them?`;
  }
  if (isFiller(text)) {
    return dwight
      ? "Take your time. I am still here."
      : "Yeah. No rush — I'm still on the line. What's on your mind?";
  }
  return null;
}

export function rememberSalesReply(to: AgentId, text: string, reply: string): void {
  if (!cacheableAsk(text)) return;
  cache.set(`${to}:${norm(text)}`, reply);
}

export function saleThanks(state: OfficeState): string {
  const { label, qty, unit } = skuLine(state);
  return `Hey, that's great — ${qty} ${unit} of ${label}. I'll have Pam write it up. Thanks for calling.`;
}

export function hangupLine(from: AgentId): string {
  if (from === "dwight") return "Goodbye. I am hanging up now.";
  if (from === "pam") return "Okay — thanks for calling. Bye!";
  return "Alright. Talk later.";
}

export function deliverCallLine(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  from: AgentId,
  text: string,
  opts?: { wait?: boolean },
): void {
  const time = formatClock(state.clock);
  const line = { from, to: "you" as const, text, time };
  state.customerLog.push(line);
  if (opts?.wait !== false) {
    state.pendingCustomer = { agentId: from, requestId: crypto.randomUUID(), question: text };
  }
  state.lastCustomerText = "";
  state.lastCustomerTo = null;
  rememberShort(state.shortTerm, from, `On the phone: ${text}`, time, "interaction");
  emit({ type: "customer_line", ...line });
  emit({ type: "say", agentId: from, text: text.slice(0, 110) });
}

export function deliverSalesLine(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  to: AgentId,
  text: string,
): void {
  deliverCallLine(state, emit, to, text);
}

export const STANDUP_LINES: Record<AgentId, string> = {
  michael: "Phone's gonna ring. I want a closed sale before lunch.",
  angela: "Price sheet is firm. Pam transfers. Jim or Dwight — whoever they ask for.",
  jim: "I'll talk if they ask for me. Human first. Paper second.",
  dwight: "I will greet the caller. Paper facts only if they ask.",
  pam: "I pick up. Small talk. Then I transfer. Do not hover over my desk.",
};
