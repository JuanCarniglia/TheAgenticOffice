import type { WebSocket } from "ws";
import type { ClientMessage, OfficeEvent, SessionConfig } from "../shared/types.js";
import { DEFAULT_GOAL, SPEED_MS } from "../shared/types.js";
import { isSales, looksLikeHangup } from "../shared/roster.js";
import { officeLog, summarizeEvent } from "../shared/trace.js";
import { HUMAN_MAX_CHARS, screenHumanText, tokenBudgetSpent } from "../shared/guardrails.js";
import { advanceClock, formatClock } from "../shared/clock.js";
import { emptyState, snapshot, tryCloseSale } from "./officeState.js";
import { MockEngine } from "./mockEngine.js";
import { runGraphTick, startGraphSession } from "./graph.js";
import { startCursorSession, type CursorHandle } from "./cursorEngine.js";
import { LongTermMemory, rememberShort } from "./memory.js";
import {
  applyLogin,
  applyLunch,
  applyStandup,
  applyWrap,
  dueSchedule,
  markFired,
  recallWanderers,
  scriptedMeetingTurn,
} from "./environment.js";
import { drainBeat, handlePamCallerReply, hangUpCall, maybeQueueFloorBits, queueInboundCall } from "./beats.js";
import { cannedSalesReply, deliverSalesLine, rememberSalesReply } from "./salesScript.js";

type GraphHandle = Awaited<ReturnType<typeof startGraphSession>>;

export class OfficeSession {
  private state = emptyState({
    goal: "",
    provider: "mock",
    model: "scripted-office",
    speed: "normal",
  });
  private readonly clients = new Set<WebSocket>();
  private readonly mock = new MockEngine();
  private readonly memory = new LongTermMemory();
  private graph: GraphHandle | null = null;
  private cursor: CursorHandle | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private threadId = "office";

  attach(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
  }

  async handle(message: ClientMessage): Promise<void> {
    officeLog("client", message.type, message);
    if (message.type === "start") {
      await this.start(message);
      return;
    }
    if (message.type === "set_speed") {
      this.state.speed = message.speed;
      this.armClock();
      return;
    }
    if (message.type === "dial") {
      if (!isSales(message.to)) return;
      if (queueInboundCall(this.state, message.to)) {
        setTimeout(() => {
          void this.tick();
        }, 200);
      }
      return;
    }
    if (message.type === "hangup") {
      if (hangUpCall(this.state, (e) => this.emit(e))) {
        setTimeout(() => {
          void this.tick();
        }, 200);
      }
      return;
    }
    if (message.type === "customer_say") {
      if (!isSales(message.to)) return;
      const verdict = screenHumanText(message.text, {
        channel: "customer",
        todayTokens: this.state.todayTokens,
        agentId: message.to,
      });
      if (!verdict.ok) {
        officeLog("guardrail", "customer", verdict.reason, message.text.slice(0, 80));
        this.emit({
          type: "guardrail",
          channel: "customer",
          reason: verdict.reason,
          reply: verdict.reply,
          agentId: message.to,
        });
        const time = formatClock(this.state.clock);
        const shown =
          message.text.length > HUMAN_MAX_CHARS
            ? `${message.text.slice(0, HUMAN_MAX_CHARS)}…`
            : message.text.trim();
        this.emit({ type: "customer_line", from: "you", to: message.to, text: shown, time });
        this.emit({
          type: "customer_line",
          from: message.to,
          to: "you",
          text: verdict.reply,
          time,
        });
        this.emit({ type: "say", agentId: message.to, text: verdict.reply.slice(0, 110) });
        this.state.pendingCustomer = {
          agentId: message.to,
          requestId: crypto.randomUUID(),
          question: verdict.reply,
        };
        return;
      }
      const bye = looksLikeHangup(verdict.text);
      if (this.state.callPhase === "idle") {
        if (bye) return;
        queueInboundCall(this.state, message.to);
      }
      if (this.state.provider === "mock") {
        this.mock.onCustomerSay(this.state, (e) => this.emit(e), message.to, verdict.text);
      } else if (this.state.callPhase === "pam" || this.state.callPhase === "ringing") {
        const time = formatClock(this.state.clock);
        const line = { from: "you" as const, to: "pam" as const, text: verdict.text, time };
        this.state.customerLog.push(line);
        rememberShort(this.state.shortTerm, "pam", `Caller: ${verdict.text}`, time, "interaction");
        this.emit({ type: "customer_line", ...line });
        if (bye) hangUpCall(this.state, (e) => this.emit(e), "pam");
        else if (this.state.callPhase === "pam") {
          handlePamCallerReply(this.state, (e) => this.emit(e), verdict.text);
        }
      } else if (this.state.callPhase !== "live") {
        const time = formatClock(this.state.clock);
        const line = { from: "you" as const, to: "pam" as const, text: verdict.text, time };
        this.state.customerLog.push(line);
        rememberShort(this.state.shortTerm, "pam", `Caller: ${verdict.text}`, time, "interaction");
        this.emit({ type: "customer_line", ...line });
      } else {
        const time = formatClock(this.state.clock);
        this.state.pendingCustomer = null;
        this.state.salesTurns += 1;
        const line = { from: "you" as const, to: message.to, text: verdict.text, time };
        this.state.customerLog.push(line);
        rememberShort(this.state.shortTerm, message.to, `Customer: ${verdict.text}`, time, "interaction");
        this.emit({ type: "customer_line", ...line });
        const closed = tryCloseSale(this.state, (e) => this.emit(e), message.to, verdict.text);
        if (bye) {
          hangUpCall(this.state, (e) => this.emit(e), message.to);
        } else if (!closed) {
          const canned = cannedSalesReply(this.state, message.to, verdict.text);
          if (canned) {
            rememberSalesReply(message.to, verdict.text, canned);
            deliverSalesLine(this.state, (e) => this.emit(e), message.to, canned);
          } else {
            this.state.lastCustomerTo = message.to;
            this.state.lastCustomerText = verdict.text;
          }
        }
      }
      setTimeout(() => {
        void this.tick();
      }, 250);
      return;
    }
    if (message.type === "human_reply") {
      if (!this.state.pendingHuman) return;
      if (this.state.pendingHuman.requestId !== message.requestId) return;
      const verdict = screenHumanText(message.text, {
        channel: "hq",
        todayTokens: this.state.todayTokens,
        agentId: message.agentId,
      });
      if (!verdict.ok) {
        officeLog("guardrail", "hq", verdict.reason, message.text.slice(0, 80));
        this.emit({
          type: "guardrail",
          channel: "hq",
          reason: verdict.reason,
          reply: verdict.reply,
          agentId: message.agentId,
        });
        this.emit({ type: "say", agentId: message.agentId, text: verdict.reply.slice(0, 110) });
        this.emit({
          type: "ask_human",
          agentId: this.state.pendingHuman.agentId,
          question: verdict.reply,
          requestId: this.state.pendingHuman.requestId,
        });
        return;
      }
      if (this.state.provider === "mock") {
        this.mock.onHumanReply(this.state, (e) => this.emit(e), message.agentId, verdict.text);
      } else {
        const time = formatClock(this.state.clock);
        this.state.pendingHuman = null;
        this.state.mailboxes[message.agentId].push({
          id: crypto.randomUUID(),
          from: "human",
          to: message.agentId,
          text: verdict.text,
          time,
        });
        rememberShort(
          this.state.shortTerm,
          message.agentId,
          `HQ replied: ${verdict.text}`,
          time,
          "decision",
        );
        this.emit({
          type: "say",
          agentId: message.agentId,
          text: `Copy that — “${verdict.text.slice(0, 48)}”`,
        });
      }
      setTimeout(() => {
        void this.tick();
      }, 250);
    }
  }

  snapshot() {
    return snapshot(this.state);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.graph = null;
    const cursor = this.cursor;
    this.cursor = null;
    void cursor?.close();
  }

  private async start(config: SessionConfig): Promise<void> {
    this.stop();
    this.threadId = `office-${Date.now()}`;
    const goalScreen = screenHumanText(config.goal, { channel: "goal" });
    const goal = goalScreen.ok ? goalScreen.text : DEFAULT_GOAL;
    this.state = emptyState({ ...config, goal });
    await this.memory.load();
    if (!goalScreen.ok) {
      this.emit({
        type: "guardrail",
        channel: "goal",
        reason: goalScreen.reason,
        reply: goalScreen.reply,
      });
      this.emit({ type: "error", message: `Goal blocked — using default. ${goalScreen.reply}` });
    }

    try {
      if (config.provider === "mock") {
        await this.mock.reset(this.state, (e) => this.emit(e));
      } else if (config.provider === "cursor") {
        this.cursor = await startCursorSession(this.state, (e) => this.emit(e), this.memory);
        this.fireDueSchedule();
      } else {
        this.graph = await startGraphSession(this.state, (e) => this.emit(e), this.memory);
        this.fireDueSchedule();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start session";
      this.emit({ type: "error", message });
      this.state.provider = "mock";
      await this.mock.reset(this.state, (e) => this.emit(e));
    }

    this.armClock();
    setTimeout(() => {
      void this.tick();
    }, 700);
  }

  private armClock(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.tick();
    }, SPEED_MS[this.state.speed]);
  }

  private fireDueSchedule(): boolean {
    const hit = dueSchedule(this.state);
    if (!hit) return false;
    markFired(this.state, hit.id);
    if (hit.id === "login") applyLogin(this.state, (e) => this.emit(e));
    if (hit.id === "standup") applyStandup(this.state, (e) => this.emit(e));
    if (hit.id === "lunch") applyLunch(this.state, (e) => this.emit(e));
    if (hit.id === "wrap") applyWrap(this.state, (e) => this.emit(e));
    return true;
  }

  private async tick(): Promise<void> {
    if (this.state.busy) return;
    if (this.state.pendingHuman) return;
    this.state.busy = true;
    this.state.tick += 1;
    this.state.clock = advanceClock(this.state.clock);
    officeLog(
      "tick",
      `#${this.state.tick}`,
      formatClock(this.state.clock),
      this.state.provider,
      this.state.pendingCustomer ? `waiting:${this.state.pendingCustomer.agentId}` : "free",
      this.state.lastCustomerTo ? `reply-as:${this.state.lastCustomerTo}` : "",
    );
    this.emit({ type: "tick", n: this.state.tick, time: formatClock(this.state.clock) });
    this.emit({ type: "clock", time: formatClock(this.state.clock) });
    try {
      recallWanderers(this.state, (e) => this.emit(e));
      maybeQueueFloorBits(this.state);
      if (drainBeat(this.state, (e) => this.emit(e))) {
        return;
      }
      if (this.state.provider !== "mock" && tokenBudgetSpent(this.state.todayTokens)) {
        if (!this.state.tokenCapNotified) {
          this.state.tokenCapNotified = true;
          this.emit({
            type: "error",
            message: "Day token budget reached — agents will not take new LLM work.",
          });
        }
        return;
      }
      if (this.state.provider === "mock") {
        await this.mock.tick(this.state, (e) => this.emit(e));
      } else {
        this.fireDueSchedule();
        if (scriptedMeetingTurn(this.state, (e) => this.emit(e))) {
          return;
        }
        if (this.state.lastCustomerText && this.state.lastCustomerTo) {
          if (this.cursor) {
            await this.cursor.tick();
          } else if (this.graph) {
            await runGraphTick(
              this.graph,
              this.state,
              `sales-${this.state.tick}-${Date.now()}`,
              this.memory,
              (e) => this.emit(e),
            );
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tick failed";
      this.emit({ type: "error", message });
    } finally {
      this.state.busy = false;
    }
  }

  private emit(event: OfficeEvent): void {
    officeLog("event", summarizeEvent(event));
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
}
