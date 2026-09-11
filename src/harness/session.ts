import type { WebSocket } from "ws";
import type { ClientMessage, OfficeEvent, SessionConfig } from "../shared/types.js";
import {
  applyLockedOfficeOptions,
  DEFAULT_GOAL,
  SPEED_MS,
  idleLockDue,
  lockedOfficeOptionsFromEnv,
  type AgentId,
} from "../shared/types.js";
import { isSales, looksLikeHangup } from "../shared/roster.js";
import { officeLog, officeLogEvent } from "../shared/trace.js";
import { HUMAN_MAX_CHARS, screenHumanText, tokenBudgetSpent } from "../shared/guardrails.js";
import { advanceClock, formatClock } from "../shared/clock.js";
import { emptyState, isLiveOffice, recordTokens, snapshot, tryCloseSale } from "./officeState.js";
import { MockEngine } from "./mockEngine.js";
import { resetCallThread, runGraphTick, startGraphSession } from "./graph.js";
import { startCursorSession, type CursorHandle } from "./cursorEngine.js";
import { announceTokenCap, queueSupervisor, runSupervisorEvent } from "./supervisor.js";
import { LongTermMemory, rememberShort } from "./memory.js";
import {
  applyLogin,
  applyLunch,
  applyWrap,
  dueSchedule,
  flushHeldStandup,
  holdOrApplyStandup,
  markFired,
  recallWanderers,
  scriptedMeetingTurn,
} from "./environment.js";
import {
  drainBeat,
  handlePamCallerReply,
  hangUpAfterSpokenLine,
  hangUpCall,
  maybeQueueFloorBits,
  queueInboundCall,
} from "./beats.js";
import { cannedSalesReply, deliverSalesLine } from "./salesScript.js";
import { performLine } from "./voice.js";

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
  private lastPlayAt = Date.now();
  private locked = false;

  attach(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) this.stop();
    });
  }

  async handle(message: ClientMessage): Promise<void> {
    officeLog("client", message.type, message);
    if (message.type === "stop") {
      this.stop();
      return;
    }
    this.lastPlayAt = Date.now();
    if (this.locked && message.type !== "start") return;
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
        if (this.graph) resetCallThread(this.graph);
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
      const skuBefore = this.state.lastPitchSkuId;
      const qtyBefore = this.state.lastPitchQty;
      const bye = looksLikeHangup(verdict.text);
      if (this.state.callPhase === "idle") {
        if (bye) return;
        queueInboundCall(this.state, message.to);
      }
      if (this.state.provider === "mock") {
        await this.mock.onCustomerSay(this.state, (e) => this.emit(e), message.to, verdict.text);
      } else if (this.state.callPhase === "pam" || this.state.callPhase === "ringing") {
        const time = formatClock(this.state.clock);
        const line = { from: "you" as const, to: "pam" as const, text: verdict.text, time };
        this.state.customerLog.push(line);
        rememberShort(this.state.shortTerm, "pam", `Caller: ${verdict.text}`, time, "interaction");
        this.emit({ type: "customer_line", ...line });
        if (bye) {
          hangUpCall(this.state, (e) => this.emit(e), "pam");
          if (this.graph) resetCallThread(this.graph);
        }
        else if (this.state.callPhase === "pam") {
          await handlePamCallerReply(this.state, (e) => this.emit(e), verdict.text);
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
        if (this.state.callClosedSale) return;
        const closed = tryCloseSale(this.state, (e) => this.emit(e), message.to, verdict.text);
        if (closed) {
          const spoken = this.state.customerLog.at(-1)?.text ?? "";
          hangUpAfterSpokenLine(this.state, (e) => this.emit(e), message.to, spoken, () => {
            if (this.graph) resetCallThread(this.graph);
          });
        } else if (bye) {
          hangUpCall(this.state, (e) => this.emit(e), message.to);
          if (this.graph) resetCallThread(this.graph);
        } else {
          const canned = cannedSalesReply(this.state, message.to, verdict.text);
          if (canned) {
            const line = await performLine({
              provider: this.state.provider,
              model: this.state.model,
              todayTokens: this.state.todayTokens,
              agentId: message.to,
              cue: `On the phone. Keep every price, quantity, and paper name exact. Speak naturally as yourself.\nDraft:\n${canned}`,
              fallback: canned,
              max: 180,
              strictFacts: true,
              onTokens: (n) => recordTokens(this.state, n, (e) => this.emit(e)),
            });
            deliverSalesLine(this.state, (e) => this.emit(e), message.to, line);
          } else {
            this.state.lastCustomerTo = message.to;
            this.state.lastCustomerText = verdict.text;
          }
        }
      }
      if (
        this.state.lastPitchSkuId !== skuBefore ||
        this.state.lastPitchQty !== qtyBefore
      ) {
        void this.rememberRequirement(
          message.to,
          `Caller wants ${this.state.lastPitchQty} of ${this.state.lastPitchSkuId}`,
        );
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
    this.locked = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.graph = null;
    const cursor = this.cursor;
    this.cursor = null;
    void cursor?.close();
  }

  private lockOffice(): void {
    if (this.locked) return;
    this.locked = true;
    this.stop();
    officeLog("idle", "office locked — no player chat for 3 minutes");
    this.emit({ type: "office_locked" });
  }

  private async start(config: SessionConfig): Promise<void> {
    this.stop();
    this.locked = false;
    this.lastPlayAt = Date.now();
    this.threadId = `office-${Date.now()}`;
    const locked = applyLockedOfficeOptions(config, lockedOfficeOptionsFromEnv(process.env));
    const goalScreen = screenHumanText(locked.goal, { channel: "goal" });
    const goal = goalScreen.ok ? goalScreen.text : DEFAULT_GOAL;
    this.state = emptyState({ ...locked, goal });
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
      if (locked.provider === "mock") {
        await this.mock.reset(this.state, (e) => this.emit(e));
      } else if (locked.provider === "cursor") {
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
    if (hit.id === "standup") {
      if (holdOrApplyStandup(this.state, (e) => this.emit(e))) {
        queueSupervisor(this.state, "standup");
      }
    }
    if (hit.id === "lunch") applyLunch(this.state, (e) => this.emit(e));
    if (hit.id === "wrap") applyWrap(this.state, (e) => this.emit(e));
    return true;
  }

  private async tick(): Promise<void> {
    if (this.locked) return;
    if (this.state.busy) return;
    if (idleLockDue(this.lastPlayAt)) {
      this.lockOffice();
      return;
    }
    if (this.state.pendingHuman) return;
    this.state.busy = true;
    this.state.tick += 1;
    this.state.clock = advanceClock(this.state.clock);
    this.emit({ type: "tick", n: this.state.tick, time: formatClock(this.state.clock) });
    this.emit({ type: "clock", time: formatClock(this.state.clock) });
    try {
      recallWanderers(this.state, (e) => this.emit(e));
      maybeQueueFloorBits(this.state);
      if (await drainBeat(this.state, (e) => this.emit(e))) {
        return;
      }
      if (flushHeldStandup(this.state, (e) => this.emit(e))) {
        if (isLiveOffice(this.state)) queueSupervisor(this.state, "standup");
        return;
      }
      if (this.state.provider !== "mock" && tokenBudgetSpent(this.state.todayTokens)) {
        if (!this.state.tokenCapNotified) {
          this.state.tokenCapNotified = true;
          this.emit({
            type: "error",
            message: "Day token budget reached — agents will not take new LLM work.",
          });
          if (isLiveOffice(this.state)) announceTokenCap(this.state, (e) => this.emit(e));
          this.state.floor = "scripted";
        }
        return;
      }
      if (this.state.provider === "mock") {
        await this.mock.tick(this.state, (e) => this.emit(e));
      } else {
        this.fireDueSchedule();
        if (isLiveOffice(this.state) && this.state.pendingSupervisor) {
          await runSupervisorEvent(this.state, this.memory, (e) => this.emit(e));
          return;
        }
        if (isLiveOffice(this.state) && this.state.meeting && this.state.supervisorDone.includes("standup")) {
          return;
        }
        if (!isLiveOffice(this.state) && (await scriptedMeetingTurn(this.state, (e) => this.emit(e)))) {
          return;
        }
        if (this.state.lastCustomerText && this.state.lastCustomerTo) {
          if (this.cursor) {
            await this.cursor.tick();
          } else if (this.graph) {
            await runGraphTick(
              this.graph,
              this.state,
              `call-${this.state.tick}`,
              this.memory,
              (e) => this.emit(e),
            );
          }
          if (isLiveOffice(this.state)) {
            this.state.liveTurnsWithoutClose += 1;
            if (this.state.liveTurnsWithoutClose >= 3) {
              queueSupervisor(this.state, "stall");
            }
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tick failed";
      this.emit({ type: "error", message });
    } finally {
      this.state.busy = false;
      if (!this.locked && idleLockDue(this.lastPlayAt)) this.lockOffice();
    }
  }

  private emit(event: OfficeEvent): void {
    officeLogEvent("event", event);
    if (event.type === "sale") {
      this.state.liveTurnsWithoutClose = 0;
      void this.rememberRequirement(
        event.salesperson,
        `Sold ${event.qty} ${event.unit} of ${event.label}`,
      );
      if (event.revenue >= 100) queueSupervisor(this.state, "sale100");
    }
    if (event.type === "reorder_alert") {
      queueSupervisor(this.state, "reorder", event.skuId);
    }
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  private async rememberRequirement(agentId: AgentId, text: string): Promise<void> {
    const time = formatClock(this.state.clock);
    await this.memory.remember({ agentId, kind: "requirement", text, time });
    this.emit({ type: "trace", agentId, tool: "remember", summary: text });
  }
}
