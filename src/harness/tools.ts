import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentId, OfficeEvent, TaskStatus, ZoneId } from "../shared/types.js";
import { AGENT_ID_TUPLE, AGENT_IDS, isSales, workerById } from "../shared/roster.js";
import { formatClock } from "../shared/clock.js";
import { SKU_ID_TUPLE } from "../shared/catalog.js";
import { HUMAN_MAX_CHARS, screenToolText } from "../shared/guardrails.js";
import { matchSkuFromText, qtyFromText } from "../shared/commerce.js";
import { applySale, syncTicket, type OfficeState } from "./officeState.js";
import { LongTermMemory, rememberShort } from "./memory.js";
import { endMeeting, recordMeetingLine, startMeeting } from "./environment.js";

const ZONES = [
  "entrance",
  "reception",
  "waiting",
  "manager_office",
  "conference_room",
  "bullpen_sales",
  "bullpen_dwight",
  "accounting",
  "kitchen",
  "breakroom",
  "annex",
  "water_cooler",
] as const;

export interface ToolContext {
  state: OfficeState;
  emit: (event: OfficeEvent) => void;
  agentId: AgentId;
  memory: LongTermMemory;
}

export function createOfficeTools(ctx: ToolContext) {
  const time = () => formatClock(ctx.state.clock);
  const actor = () => workerById(ctx.agentId);
  const spoken = (text: string, max: number) => {
    const screened = screenToolText(text);
    if (!screened.ok) return { ok: false as const, error: `Won't say that. ${screened.reply}` };
    return { ok: true as const, text: screened.text.slice(0, max) };
  };

  const say = tool(
    async ({ text }: { text: string }) => {
      const line = spoken(text, 110);
      if (!line.ok) return line.error;
      const clipped = line.text;
      rememberShort(ctx.state.shortTerm, ctx.agentId, `Said: ${clipped}`, time());
      ctx.emit({ type: "say", agentId: ctx.agentId, text: clipped });
      return "Said it on the floor.";
    },
    {
      name: "say",
      description: "Public speech balloon. Keep it under 110 characters so it fits.",
      schema: z.object({ text: z.string() }),
    },
  );

  const watercooler = tool(
    async ({ text }: { text: string }) => {
      const line = spoken(text, 160);
      if (!line.ok) return line.error;
      const clipped = line.text;
      const post = {
        id: crypto.randomUUID(),
        from: ctx.agentId,
        text: clipped,
        time: time(),
      };
      ctx.state.watercooler.push(post);
      rememberShort(ctx.state.shortTerm, ctx.agentId, `Watercooler: ${clipped}`, time(), "gossip");
      await ctx.memory.remember({
        agentId: ctx.agentId,
        kind: "gossip",
        text: clipped,
        time: time(),
      });
      ctx.emit({ type: "watercooler", ...post });
      ctx.emit({ type: "say", agentId: ctx.agentId, text: clipped });
      return "Posted to the watercooler.";
    },
    {
      name: "watercooler",
      description: "Broadcast to the shared office channel (Slack-like). Casual updates, questions, gossip.",
      schema: z.object({ text: z.string() }),
    },
  );

  const dm = tool(
    async ({ agentId, message }: { agentId: AgentId; message: string }) => {
      if (!AGENT_IDS.includes(agentId) || agentId === ctx.agentId) return "Invalid coworker.";
      const line = spoken(message, 180);
      if (!line.ok) return line.error;
      const msg = line.text;
      const note = { id: crypto.randomUUID(), from: ctx.agentId, to: agentId, text: msg, time: time() };
      ctx.state.mailboxes[agentId].push(note);
      rememberShort(ctx.state.shortTerm, ctx.agentId, `DM to ${agentId}: ${msg}`, time());
      rememberShort(ctx.state.shortTerm, agentId, `DM from ${ctx.agentId}: ${msg}`, time());
      ctx.emit({ type: "dm", from: ctx.agentId, to: agentId, text: msg });
      ctx.emit({ type: "whisper", agentId: ctx.agentId, text: `→ ${workerById(agentId).name}: ${msg}` });
      return `Private message delivered to ${agentId}.`;
    },
    {
      name: "dm",
      description: "Private 1:1. Use for task details, blockers, or anything that should not hit the watercooler.",
      schema: z.object({
        agentId: z.enum(AGENT_ID_TUPLE),
        message: z.string(),
      }),
    },
  );

  const askHuman = tool(
    async ({ question }: { question: string }) => {
      const requestId = crypto.randomUUID();
      const line = spoken(question, HUMAN_MAX_CHARS);
      if (!line.ok) return line.error;
      const q = line.text;
      ctx.state.pendingHuman = { agentId: ctx.agentId, requestId, question: q };
      ctx.emit({ type: "ask_human", agentId: ctx.agentId, question: q, requestId });
      return "Waiting for HQ. Do not invent their answer.";
    },
    {
      name: "ask_human",
      description: "Ask the human operator via a speech balloon.",
      schema: z.object({ question: z.string() }),
    },
  );

  const assignTask = tool(
    async ({
      id,
      title,
      owner,
      note,
    }: {
      id: string;
      title: string;
      owner: AgentId;
      note: string;
    }) => {
      if (actor().orgRole !== "ceo" && actor().orgRole !== "pm") {
        return "Only the CEO or PM can assign tickets.";
      }
      const ticket = {
        id: id || `AO-${ctx.state.tasks.length + 1}`,
        title: title.slice(0, 80),
        owner,
        reporter: ctx.agentId,
        status: "todo" as const,
        note: note.slice(0, 160),
        kind: "company" as const,
      };
      syncTicket(ctx.state, ticket);
      ctx.emit({ type: "task_update", task: { ...ticket } });
      ctx.emit({ type: "queue_update", agentId: owner, queue: ctx.state.queues[owner].map((t) => ({ ...t })) });
      rememberShort(
        ctx.state.shortTerm,
        ctx.agentId,
        `Assigned ${ticket.id} to ${owner}: ${ticket.title}`,
        time(),
        "requirement",
      );
      return `Ticket ${ticket.id} assigned to ${owner}.`;
    },
    {
      name: "assign_task",
      description: "CEO/PM only. Put a ticket on the shared board and the worker's personal queue.",
      schema: z.object({
        id: z.string(),
        title: z.string(),
        owner: z.enum(AGENT_ID_TUPLE),
        note: z.string(),
      }),
    },
  );

  const updateTask = tool(
    async ({ id, status, note }: { id: string; status: TaskStatus; note: string }) => {
      const task = ctx.state.tasks.find((t) => t.id === id);
      if (!task) return `Unknown ticket ${id}.`;
      task.status = status;
      task.note = note.slice(0, 160);
      syncTicket(ctx.state, task);
      ctx.emit({ type: "task_update", task: { ...task } });
      ctx.emit({
        type: "queue_update",
        agentId: task.owner,
        queue: ctx.state.queues[task.owner].map((t) => ({ ...t })),
      });
      return `Ticket ${id} is now ${status}.`;
    },
    {
      name: "update_task",
      description: "Update a ticket on the shared board and the owner's queue.",
      schema: z.object({
        id: z.string(),
        status: z.enum(["todo", "doing", "done"]),
        note: z.string(),
      }),
    },
  );

  const callMeeting = tool(
    async ({ title, topic, attendees }: { title: string; topic: string; attendees: AgentId[] }) => {
      if (ctx.state.meeting) return "A meeting is already in progress.";
      if (actor().orgRole !== "ceo" && actor().orgRole !== "pm") {
        return "Only the CEO or PM can call a meeting.";
      }
      const people = attendees.filter((id) => AGENT_IDS.includes(id));
      if (!people.includes(ctx.agentId)) people.unshift(ctx.agentId);
      const meeting = startMeeting(ctx.state, title.slice(0, 40), topic.slice(0, 120), people, people.length);
      ctx.emit({
        type: "meeting_start",
        title: meeting.title,
        topic: meeting.topic,
        attendees: meeting.attendees,
      });
      for (const id of meeting.attendees) {
        ctx.state.positions[id] = "conference_room";
        ctx.emit({ type: "move_to", agentId: id, zone: "conference_room" });
      }
      return `Meeting "${meeting.title}" started. Individual queues are paused.`;
    },
    {
      name: "call_meeting",
      description: "CEO/PM: pause personal queues and pull people into the conference room.",
      schema: z.object({
        title: z.string(),
        topic: z.string(),
        attendees: z.array(z.enum(AGENT_ID_TUPLE)),
      }),
    },
  );

  const meetingSpeak = tool(
    async ({ text }: { text: string }) => {
      if (!ctx.state.meeting) return "You are not in a meeting.";
      const line = spoken(text, 110);
      if (!line.ok) return line.error;
      const clipped = line.text;
      recordMeetingLine(ctx.state, ctx.agentId, clipped);
      rememberShort(ctx.state.shortTerm, ctx.agentId, `Standup: ${clipped}`, time());
      ctx.emit({ type: "meeting_say", agentId: ctx.agentId, text: clipped });
      ctx.emit({ type: "say", agentId: ctx.agentId, text: clipped });
      if (ctx.state.meeting.remainingTurns <= 0) {
        const done = endMeeting(ctx.state);
        if (done) ctx.emit({ type: "meeting_end", title: done.title });
      }
      return "Logged in the meeting.";
    },
    {
      name: "meeting_speak",
      description: "Speak during a meeting. One line. After the last turn the meeting ends.",
      schema: z.object({ text: z.string() }),
    },
  );

  const pitchCustomer = tool(
    async ({ text }: { text: string }) => {
      if (!isSales(ctx.agentId)) return "Only Jim or Dwight may talk to the customer.";
      if (ctx.state.callPhase !== "live") return "The caller hung up. Do not speak on the line.";
      const spokenLine = spoken(text, HUMAN_MAX_CHARS);
      if (!spokenLine.ok) return spokenLine.error;
      const clipped = spokenLine.text;
      const balloon = clipped.slice(0, 110);
      const requestId = crypto.randomUUID();
      const matched = matchSkuFromText(ctx.state.stock, clipped);
      if (matched) ctx.state.lastPitchSkuId = matched.id;
      ctx.state.lastPitchQty = qtyFromText(clipped, ctx.state.lastPitchQty);
      ctx.state.outreachLead = ctx.agentId;
      ctx.state.pendingCustomer = { agentId: ctx.agentId, requestId, question: clipped };
      const chatLine = { from: ctx.agentId, to: "you" as const, text: clipped, time: time() };
      ctx.state.customerLog.push(chatLine);
      rememberShort(ctx.state.shortTerm, ctx.agentId, `Pitched customer: ${clipped}`, time());
      ctx.emit({ type: "customer_line", ...chatLine });
      ctx.emit({ type: "say", agentId: ctx.agentId, text: balloon });
      return "Waiting for the customer to type a reply. Do not invent it.";
    },
    {
      name: "pitch_customer",
      description:
        "Jim/Dwight only. Speak one human line on the phone and wait. Chat first. Quote SKU or price only if they asked. This is the only way to talk to the player.",
      schema: z.object({ text: z.string() }),
    },
  );

  const ringUp = tool(
    async ({ skuId, qty }: { skuId: string; qty: number }) => {
      if (!isSales(ctx.agentId)) return "Only Jim or Dwight may ring up a sale.";
      const result = applySale(ctx.state, skuId, qty, ctx.agentId, ctx.emit);
      if (!result.ok) return result.message;
      const sku = result.sku!;
      if (result.hitReorder) {
        return `Sold ${result.qty} ${sku.unit}. Balance updated. WAREHOUSE MIN HIT — Angela must ask Pam to reorder ${sku.id}.`;
      }
      return `Sold ${result.qty} ${sku.unit} of ${sku.id} for $${result.revenue}.`;
    },
    {
      name: "ring_up",
      description:
        "Jim/Dwight only. Decrement warehouse stock and add cash after the customer agrees. Use the sku id from the warehouse list.",
      schema: z.object({
        skuId: z.enum(SKU_ID_TUPLE),
        qty: z.number().int().min(1).max(200),
      }),
    },
  );

  const remember = tool(
    async ({ text, kind }: { text: string; kind: "interaction" | "requirement" | "gossip" | "decision" }) => {
      const screened = screenToolText(text);
      if (!screened.ok) return `Not filed — ${screened.reply}`;
      await ctx.memory.remember({
        agentId: ctx.agentId,
        kind,
        text: screened.text,
        time: time(),
      });
      return "Filed in long-term memory.";
    },
    {
      name: "remember",
      description: "Store a fact in long-term memory (decisions, requirements, gossip).",
      schema: z.object({
        text: z.string(),
        kind: z.enum(["interaction", "requirement", "gossip", "decision"]),
      }),
    },
  );

  const recall = tool(
    async ({ query }: { query: string }) => {
      const screened = screenToolText(query);
      if (!screened.ok) return `Can't search that. ${screened.reply}`;
      const facts = await ctx.memory.recall(ctx.agentId, screened.text, 4);
      return ctx.memory.formatRecall(facts);
    },
    {
      name: "recall",
      description: "Search your long-term memory and shared gossip/requirements.",
      schema: z.object({ query: z.string() }),
    },
  );

  const moveTo = tool(
    async ({ zone }: { zone: ZoneId }) => {
      if (ctx.state.meeting) return "Stay in the meeting until it ends.";
      if (isSales(ctx.agentId) && (zone === "waiting" || zone === "entrance" || zone === "reception")) {
        const home = actor().home;
        ctx.state.positions[ctx.agentId] = home;
        ctx.emit({ type: "move_to", agentId: ctx.agentId, zone: home });
        return "Stay at your desk. Take the call from there.";
      }
      if (ctx.agentId === "pam" && zone !== "reception" && zone !== "conference_room") {
        ctx.state.positions.pam = "reception";
        ctx.emit({ type: "move_to", agentId: "pam", zone: "reception" });
        return "Pam stays at reception, just left of the desk.";
      }
      ctx.state.positions[ctx.agentId] = zone;
      ctx.emit({ type: "move_to", agentId: ctx.agentId, zone });
      return `Walking to ${zone}.`;
    },
    {
      name: "move_to",
      description: "Walk to a named office zone. Jim and Dwight stay at their desks. Pam stays at reception.",
      schema: z.object({ zone: z.enum(ZONES) }),
    },
  );

  return [
    say,
    watercooler,
    dm,
    askHuman,
    pitchCustomer,
    ringUp,
    assignTask,
    updateTask,
    callMeeting,
    meetingSpeak,
    remember,
    recall,
    moveTo,
  ];
}
