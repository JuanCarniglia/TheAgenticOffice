import type { AgentId, OfficeEvent } from "../shared/types.js";
import {
  looksLikeAllStock,
  looksLikeGreeting,
  looksLikePurchase,
  looksLikeRejection,
  looksLikeSmallTalk,
  looksLikeStockOnHandAsk,
  workerById,
} from "../shared/roster.js";
import { formatMoney, skuLabel } from "../shared/catalog.js";
import { findSku, interpretPaperAsk } from "../shared/commerce.js";
import { formatClock } from "../shared/clock.js";
import { rememberShort } from "./memory.js";
import type { OfficeState } from "./officeState.js";

function markQuoted(state: OfficeState, line: string): string {
  state.openQuote = true;
  state.callClosedSale = false;
  return line;
}

export function lineLooksLikeQuote(text: string): boolean {
  return /\$\d|\b\d+\.\d{2}\b|\beach\b|\bper ream\b|\bper pack\b|\bwrite it up\b|\bhold them\b|\bon a ticket\b|\bshall i write\b|\bwant that on\b/i.test(
    text,
  );
}

function alreadySoldLine(state: OfficeState, to: AgentId): string {
  const sold = state.lastSale;
  const what = sold ? `${sold.qty} of ${sold.label}` : "that order";
  return to === "dwight"
    ? `That is already on today's ticket — ${what}. I will not ring it twice. A new order, or are we finished?`
    : `Already wrote that one up — ${what}. New order, or we good?`;
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

function moreThanQty(text: string): number | null {
  const m = text.match(/\b(?:more than|over|above)\s+(\d{1,3})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function quoteOnHandLot(state: OfficeState, to: AgentId): string {
  const dwight = to === "dwight";
  const sku = findSku(state.stock, state.lastPitchSkuId);
  const onHand = sku?.qty ?? 0;
  state.offeredOnHand = true;
  if (onHand < 1) {
    return dwight
      ? "That article is gone. I can quote another SKU if you wish."
      : "We're out of that one. Want me to look at something else?";
  }
  state.lastPitchQty = onHand;
  const { label, price, unit } = skuLine(state);
  return markQuoted(
    state,
    dwight
      ? `The cage has ${onHand} ${unit} of ${label} at ${price} each. That is everything today. Confirm the lot?`
      : `That's the whole cage — ${onHand} ${unit} of ${label} at ${price} each. Mill restocks later. Want the lot?`,
  );
}

function quoteChangedAsk(state: OfficeState, to: AgentId, text: string): string | null {
  const dwight = to === "dwight";
  const askedSku = interpretPaperAsk(state.stock, text)?.sku;
  if (askedSku && askedSku.id !== state.lastPitchSkuId) {
    state.lastPitchSkuId = askedSku.id;
    state.offeredOnHand = false;
  }
  const sku = findSku(state.stock, state.lastPitchSkuId);
  const onHand = sku?.qty ?? 0;

  if (looksLikeStockOnHandAsk(text)) {
    state.offeredOnHand = true;
    state.openQuote = false;
    const { label, unit } = skuLine(state);
    return dwight
      ? `${onHand} ${unit} of ${label} on the floor. That is the maximum I can write today. How many?`
      : `${onHand} ${unit} of ${label} in the cage. That's all we have today — how many do you want?`;
  }

  if (looksLikeAllStock(text)) {
    return quoteOnHandLot(state, to);
  }

  const over = moreThanQty(text);
  if (over != null) {
    if (over >= onHand) return quoteOnHandLot(state, to);
    state.openQuote = false;
    state.offeredOnHand = true;
    const { label, unit } = skuLine(state);
    return dwight
      ? `More than ${over} is possible up to ${onHand} ${unit} of ${label}. Name the quantity.`
      : `We can do more than ${over}, up to ${onHand} ${unit} of ${label}. What number?`;
  }

  if (/\bmore\b/i.test(text) && !/\b(no more|not more|nothing more)\b/i.test(text)) {
    if (state.offeredOnHand || state.lastPitchQty >= onHand) {
      return quoteOnHandLot(state, to);
    }
    state.offeredOnHand = true;
    state.openQuote = false;
    const { label, unit } = skuLine(state);
    return dwight
      ? `Understood — more than ${state.lastPitchQty}. There are ${onHand} ${unit} of ${label} on the floor. That is the max. How many?`
      : `More than ${state.lastPitchQty}? We have ${onHand} ${unit} of ${label} — that's the max today. The lot, or a number under that?`;
  }

  const ask = interpretPaperAsk(state.stock, text);
  if (!ask) return null;
  if (!ask.sku) {
    if (ask.qty != null && !ask.note) {
      if (ask.qty > onHand) return quoteOnHandLot(state, to);
      state.lastPitchQty = ask.qty;
      const { label, price, unit } = skuLine(state);
      return markQuoted(
        state,
        dwight
          ? `Quantity noted. ${ask.qty} ${unit} of ${label} at ${price} each. Shall I write it up?`
          : `Okay — ${ask.qty} ${unit} of ${label} at ${price} each. That work?`,
      );
    }
    if (!ask.note) return null;
    return dwight
      ? "We do not carry that. Recycled is A4 80 gsm only. I can quote that if you wish."
      : "We don't have that cut. Recycled we only stock as A4 80 — want me to quote it?";
  }
  state.lastPitchSkuId = ask.sku.id;
  if (ask.qty != null && ask.qty > (findSku(state.stock, ask.sku.id)?.qty ?? 0)) {
    return quoteOnHandLot(state, to);
  }
  if (ask.qty != null) state.lastPitchQty = ask.qty;
  const qty = state.lastPitchQty;
  const price = formatMoney(ask.sku.price);
  const label = skuLabel(ask.sku);
  const caveat = ask.note ? `${ask.note} ` : "";
  return markQuoted(
    state,
    dwight
      ? `${caveat}I can do ${qty} ${ask.sku.unit} of ${label} at ${price} each. Shall I write it up?`
      : `${caveat}So that's ${qty} ${ask.sku.unit} of ${label} at ${price} each. Want that on the ticket?`,
  );
}

function isFiller(text: string): boolean {
  return /^(ok|okay|sure|maybe|hmm|huh|what\??|yeah|yep|yup|uh huh|uhhuh|mm|mhm|right)$/i.test(text.trim());
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
  const { label, qty, price, unit } = skuLine(state);
  const dwight = to === "dwight";

  if (looksLikeRejection(text)) {
    return dwight
      ? "Understood. No pressure. The offer remains if you change your mind."
      : "Ha. Fair. I'll stop. Call back if you actually need paper — I'll be here.";
  }
  if (state.lastSale && !state.openQuote && looksLikePurchase(text, true)) {
    return alreadySoldLine(state, to);
  }
  if (looksLikeSmallTalk(text) || looksLikeGreeting(text)) {
    return humanChatReply(to, text, state.salesTurns);
  }
  const spec = quoteChangedAsk(state, to, text);
  if (spec) return spec;
  if (/\b(how much|price|cost|each|per ream|per pack)\b/i.test(text)) {
    return markQuoted(
      state,
      dwight
        ? `Of course. ${label} is ${price} per ${unit.replace(/s$/, "")}. I can do ${qty} if that helps.`
        : `${label} runs ${price} each. I can put ${qty} ${unit} on a ticket if you want — no hard sell.`,
    );
  }
  if (/\b(what|which|gsm|size|a3|a4|stock)\b/i.test(text) && text.length < 80) {
    return markQuoted(
      state,
      dwight
        ? `It is ${label}, ${qty} ${unit}, ${price}. 500 sheets to a ream. I can wait while you think.`
        : `We've got ${qty} ${unit} of ${label} sitting in the cage. ${price} each. Want me to hold them?`,
    );
  }
  if (isFiller(text)) {
    return dwight
      ? "Take your time. I am still here."
      : "Yeah. No rush — I'm still on the line. What's on your mind?";
  }
  return null;
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

export const STANDUP_CUES: Record<AgentId, string> = {
  michael: "Standup. Remind everyone the phone will ring and you want a closed sale before lunch. Loud, CEO energy.",
  angela: "Standup. Price sheet is firm. Pam transfers. Jim or Dwight — whoever the caller asks for. Short and exact.",
  jim: "Standup. You will talk if they ask for you. Human first, paper second. Dry.",
  dwight: "Standup. You will greet the caller. Paper facts only if they ask. Formal.",
  pam: "Standup. You pick up, small talk, then transfer. Tell them not to hover over your desk.",
};
