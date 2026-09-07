import type { AgentId } from "../../shared/types.js";
import { isSales, workerById } from "../../shared/roster.js";
import { officeLog } from "../../shared/trace.js";
import { HUMAN_MAX_CHARS, screenHumanText } from "../../shared/guardrails.js";
import { sleep, thinkDelayMs, typeDelayMs } from "../typewriter.js";

export class CustomerChat {
  private host: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private logEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private minBtn: HTMLButtonElement | null = null;
  private dragOffset = { x: 0, y: 0 };
  private dragging = false;
  private locked = false;
  private outgoing: Array<{ from: string; text: string }> = [];
  private typing = false;
  private playGen = 0;
  minimized = true;
  counterpart: AgentId = "jim";
  private inCall = false;

  constructor(
    private readonly onSend: (to: AgentId, text: string) => void,
    private readonly onDial?: (to: AgentId) => void,
    private readonly onHangup?: () => void,
  ) {}

  mount(): void {
    this.unmount();
    const game = document.getElementById("game");
    if (!game) return;
    const box = document.createElement("div");
    box.id = "customer-chat";
    box.style.cssText = [
      "position:absolute",
      "width:340px",
      "background:#e8e0cc",
      "border:2px solid #fff",
      "border-right-color:#404040",
      "border-bottom-color:#404040",
      "font-family:VT323,monospace",
      "font-size:18px",
      "color:#111",
      "z-index:25",
      "display:flex",
      "flex-direction:column",
      "box-shadow:4px 4px 0 #00000055",
      "user-select:none",
    ].join(";");
    box.innerHTML = `
      <div id="chat-titlebar" style="display:flex;align-items:center;gap:6px;background:#000080;color:#fff;padding:3px 6px;cursor:move;">
        <div id="chat-title" style="flex:1;font-size:18px;letter-spacing:0.04em;">CALL — JIM</div>
        <button data-to="jim" type="button" style="font:inherit;font-size:14px;padding:0 6px;">Jim</button>
        <button data-to="dwight" type="button" style="font:inherit;font-size:14px;padding:0 6px;">Dwight</button>
        <button id="chat-hangup" type="button" title="Hang up" style="font:inherit;font-size:13px;padding:0 6px;background:#a33;color:#fff;">HANG UP</button>
        <button id="chat-min" type="button" title="Minimize" style="font:inherit;width:22px;padding:0;">_</button>
      </div>
      <div id="chat-body" style="display:none;flex-direction:column;padding:6px 8px 8px;gap:6px;height:148px;">
        <div id="chat-log" style="flex:1;overflow:auto;background:#fffdf6;border:2px inset #808080;padding:3px 6px;line-height:1.15;font-size:17px;user-select:text;"></div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span>&gt;</span>
          <input id="chat-input" placeholder="You're on the phone…" maxlength="${HUMAN_MAX_CHARS}"
            style="flex:1;font:inherit;font-size:17px;border:2px inset #808080;padding:2px 6px;color:#111;" />
          <button id="chat-send" type="button" style="font:inherit;padding:2px 8px;">SEND</button>
        </div>
      </div>
    `;
    game.appendChild(box);
    this.host = box;
    this.bodyEl = box.querySelector("#chat-body");
    this.logEl = box.querySelector("#chat-log");
    this.inputEl = box.querySelector("#chat-input");
    this.minBtn = box.querySelector("#chat-min");
    this.placeDefault();
    this.applyMinimized();
    this.paintButtons();
    this.paintHangup();

    const bar = box.querySelector<HTMLElement>("#chat-titlebar");
    bar?.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      this.dragging = true;
      const rect = box.getBoundingClientRect();
      const gameRect = game.getBoundingClientRect();
      this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
      void gameRect;
    });
    bar?.addEventListener("pointermove", (e) => {
      if (!this.dragging || !this.host) return;
      const gameRect = game.getBoundingClientRect();
      const x = e.clientX - gameRect.left - this.dragOffset.x;
      const y = e.clientY - gameRect.top - this.dragOffset.y;
      this.clampTo(game, x, y);
    });
    bar?.addEventListener("pointerup", () => {
      this.dragging = false;
    });

    box.querySelectorAll<HTMLButtonElement>("button[data-to]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.to;
        if (id === "jim" || id === "dwight") this.setCounterpart(id, true);
      });
    });
    this.minBtn?.addEventListener("click", () => this.toggle());
    box.querySelector("#chat-hangup")?.addEventListener("click", () => this.hangUp());
    box.querySelector("#chat-send")?.addEventListener("click", () => this.flush());
    this.inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.flush();
    });
  }

  setCounterpart(id: AgentId, lock = false): void {
    if (!isSales(id)) return;
    this.counterpart = id;
    if (lock) this.locked = true;
    officeLog("chat", `talking to ${id}${this.locked ? " (locked)" : ""}`);
    const title = this.host?.querySelector("#chat-title");
    if (title) title.textContent = `CALL — ${workerById(id).name.toUpperCase()}`;
    if (this.inputEl) this.inputEl.placeholder = `Talk to ${workerById(id).name}…`;
    this.paintButtons();
    this.paintHangup();
    if (lock) this.onDial?.(id);
  }

  markOnLine(): void {
    this.inCall = true;
    this.paintHangup();
  }

  hangUp(): void {
    if (!this.inCall) return;
    this.onHangup?.();
  }

  endCall(): void {
    this.inCall = false;
    this.locked = false;
    this.waiting(false);
    this.playGen += 1;
    const leftover = this.outgoing.splice(0);
    this.typing = false;
    const title = this.host?.querySelector("#chat-title");
    if (title) title.textContent = "CALL ENDED";
    if (this.inputEl) this.inputEl.placeholder = "Call ended. Dial Jim or Dwight…";
    for (const line of leftover) this.writeRow(line.from, line.text);
    this.writeRow("—", "line disconnected");
    this.paintHangup();
  }

  /** Incoming pitch may set the default target unless the player picked Jim/Dwight. */
  followSpeaker(id: AgentId): void {
    if (this.locked) {
      officeLog("chat", `ignored auto-switch to ${id}; locked on ${this.counterpart}`);
      return;
    }
    this.setCounterpart(id, false);
  }

  addLine(from: string, text: string, instant = from === "You"): void {
    officeLog("chat", `${from}: ${text}`);
    if (instant) {
      this.writeRow(from, text);
      return;
    }
    this.outgoing.push({ from, text });
    void this.pump();
  }

  expand(opts?: { dial?: boolean }): void {
    if (!this.minimized) return;
    this.minimized = false;
    this.applyMinimized();
    this.inputEl?.focus();
    this.markOnLine();
    if (opts?.dial !== false) this.onDial?.(this.counterpart);
  }

  toggle(): void {
    this.minimized = !this.minimized;
    this.applyMinimized();
    if (!this.minimized) {
      this.markOnLine();
      this.onDial?.(this.counterpart);
    }
  }

  waiting(on: boolean): void {
    if (this.inputEl) this.inputEl.style.outline = on ? "2px solid #d4a017" : "";
    if (on) this.flash();
  }

  unmount(): void {
    this.playGen += 1;
    this.outgoing = [];
    this.typing = false;
    this.host?.remove();
    this.host = null;
    this.bodyEl = null;
    this.logEl = null;
    this.inputEl = null;
    this.minBtn = null;
  }

  private writeRow(from: string, text: string): HTMLDivElement | null {
    if (!this.logEl) return null;
    const row = document.createElement("div");
    row.textContent = `${from}: ${text}`;
    this.logEl.appendChild(row);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return row;
  }

  private async pump(): Promise<void> {
    if (this.typing) return;
    const next = this.outgoing.shift();
    if (!next) {
      this.setTalkingHint(null);
      return;
    }
    this.typing = true;
    const gen = this.playGen;
    this.setTalkingHint(next.from);
    await sleep(thinkDelayMs(next.text));
    if (gen !== this.playGen || !this.logEl) {
      this.typing = false;
      return;
    }
    const row = this.writeRow(next.from, "");
    if (!row) {
      this.typing = false;
      return;
    }
    const prefix = `${next.from}: `;
    for (let i = 0; i < next.text.length; i += 1) {
      if (gen !== this.playGen) {
        this.typing = false;
        return;
      }
      row.textContent = prefix + next.text.slice(0, i + 1);
      this.logEl.scrollTop = this.logEl.scrollHeight;
      await sleep(typeDelayMs(next.text[i]!));
    }
    this.typing = false;
    void this.pump();
  }

  private setTalkingHint(name: string | null): void {
    if (!this.inputEl) return;
    this.inputEl.placeholder = name
      ? `${name} is talking…`
      : `Talk to ${workerById(this.counterpart).name}…`;
  }

  private applyMinimized(): void {
    if (!this.bodyEl || !this.minBtn) return;
    this.bodyEl.style.display = this.minimized ? "none" : "flex";
    this.minBtn.textContent = this.minimized ? "+" : "_";
    this.minBtn.title = this.minimized ? "Restore" : "Minimize";
    requestAnimationFrame(() => this.ensureOnScreen());
  }

  private ensureOnScreen(): void {
    const game = document.getElementById("game");
    if (!game || !this.host) return;
    const x = parseFloat(this.host.style.left || "0");
    const y = parseFloat(this.host.style.top || "0");
    this.clampTo(game, x, y);
  }

  private flash(): void {
    if (!this.host) return;
    this.host.style.outline = "2px solid #d4a017";
    window.setTimeout(() => {
      if (this.host) this.host.style.outline = "";
    }, 900);
  }

  private placeDefault(): void {
    const game = document.getElementById("game");
    if (!game || !this.host) return;
    const x = Math.max(12, game.clientWidth - 358);
    const y = Math.max(12, game.clientHeight - 56);
    this.host.style.left = `${x}px`;
    this.host.style.top = `${y}px`;
  }

  private clampTo(game: HTMLElement, x: number, y: number): void {
    if (!this.host) return;
    const maxX = Math.max(8, game.clientWidth - this.host.offsetWidth - 8);
    const maxY = Math.max(8, game.clientHeight - this.host.offsetHeight - 8);
    this.host.style.left = `${Math.min(Math.max(8, x), maxX)}px`;
    this.host.style.top = `${Math.min(Math.max(8, y), maxY)}px`;
  }

  private flush(): void {
    const text = this.inputEl?.value.trim() ?? "";
    if (!text) return;
    if (this.inputEl) this.inputEl.value = "";
    const verdict = screenHumanText(text, { channel: "customer", agentId: this.counterpart });
    if (!verdict.ok) {
      officeLog("guardrail", "chat", verdict.reason);
      this.addLine("You", text.length > HUMAN_MAX_CHARS ? `${text.slice(0, HUMAN_MAX_CHARS)}…` : text, true);
      this.addLine(workerById(this.counterpart).name, verdict.reply);
      this.expand();
      return;
    }
    officeLog("chat", `send → ${this.counterpart}: ${verdict.text}`);
    this.onSend(this.counterpart, verdict.text);
  }

  private paintButtons(): void {
    this.host?.querySelectorAll<HTMLButtonElement>("button[data-to]").forEach((btn) => {
      const on = btn.dataset.to === this.counterpart;
      btn.style.background = on ? "#d4a017" : "";
      btn.style.color = on ? "#111" : "";
      btn.style.fontWeight = on ? "bold" : "";
    });
  }

  private paintHangup(): void {
    const btn = this.host?.querySelector<HTMLButtonElement>("#chat-hangup");
    if (!btn) return;
    btn.disabled = !this.inCall;
    btn.style.opacity = this.inCall ? "1" : "0.45";
    btn.style.cursor = this.inCall ? "pointer" : "default";
  }
}
