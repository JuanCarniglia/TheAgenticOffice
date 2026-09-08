import Phaser from "phaser";
import type { AgentId, Ticket, WatercoolerPost } from "../../shared/types.js";
import { workerById } from "../../shared/roster.js";
import { formatMoney } from "../../shared/catalog.js";

/** Screen-space HUD. DOM so it never zooms with the floor camera and can scroll. */
export class Hud {
  private host: HTMLDivElement | null = null;
  private inner: HTMLDivElement | null = null;
  private clockEl: HTMLElement | null = null;
  private goalEl: HTMLElement | null = null;
  private booksEl: HTMLElement | null = null;
  private coolerEl: HTMLElement | null = null;
  private taskEl: HTMLElement | null = null;
  private inspectEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private meetingEl: HTMLElement | null = null;
  private stampEl: HTMLElement | null = null;
  private lastClock = "MON 09:00";
  private readonly onResize = () => this.syncToCanvas();

  constructor(private readonly scene: Phaser.Scene) {}

  mount(): void {
    this.unmount();
    const game = document.getElementById("game");
    if (!game) return;

    const host = document.createElement("div");
    host.id = "office-hud";
    host.innerHTML = `
      <div class="hud-inner">
        <div class="hud-panel hud-goal">
          <div id="hud-clock">MON 09:00</div>
          <div id="hud-goal" class="hud-scroll">—</div>
          <div id="hud-books">${formatMoney(6000)}  ·  today +${formatMoney(0)}</div>
        </div>
        <div class="hud-panel hud-cooler">
          <div class="hud-title">WATERCOOLER</div>
          <div id="hud-cooler" class="hud-scroll">(quiet)</div>
        </div>
        <div class="hud-panel hud-tasks">
          <div class="hud-title">AGENT's TICKETS</div>
          <div id="hud-tasks" class="hud-scroll"></div>
        </div>
        <div class="hud-panel hud-inspect">
          <div id="hud-inspect" class="hud-scroll">CLICK A WORKER</div>
        </div>
        <div id="hud-meeting" class="hud-meeting" hidden></div>
        <div class="hud-status">
          <div id="hud-status">OFFICE NETWORK: CONNECTING…</div>
        </div>
        <div id="hud-stamp" hidden>QUARTERLY<br />REVIEW</div>
      </div>
    `;
    game.appendChild(host);
    this.host = host;
    this.inner = host.querySelector(".hud-inner");
    this.clockEl = host.querySelector("#hud-clock");
    this.goalEl = host.querySelector("#hud-goal");
    this.booksEl = host.querySelector("#hud-books");
    this.coolerEl = host.querySelector("#hud-cooler");
    this.taskEl = host.querySelector("#hud-tasks");
    this.inspectEl = host.querySelector("#hud-inspect");
    this.statusEl = host.querySelector("#hud-status");
    this.meetingEl = host.querySelector("#hud-meeting");
    this.stampEl = host.querySelector("#hud-stamp");

    host.querySelectorAll(".hud-scroll").forEach((el) => {
      el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    });

    this.scene.scale.on("resize", this.onResize);
    this.syncToCanvas();
  }

  unmount(): void {
    this.scene.scale.off("resize", this.onResize);
    this.host?.remove();
    this.host = null;
    this.inner = null;
    this.clockEl = null;
    this.goalEl = null;
    this.booksEl = null;
    this.coolerEl = null;
    this.taskEl = null;
    this.inspectEl = null;
    this.statusEl = null;
    this.meetingEl = null;
    this.stampEl = null;
  }

  setClock(time: string, label?: string): void {
    this.lastClock = time;
    if (this.clockEl) this.clockEl.textContent = label ? `${time}  ·  ${label}` : time;
  }

  setGoal(goal: string): void {
    if (this.goalEl) this.goalEl.textContent = goal;
  }

  setBooks(balance: number, todayEarnings: number): void {
    const sign = todayEarnings >= 0 ? "+" : "";
    if (this.booksEl) {
      this.booksEl.textContent = `${formatMoney(balance)}  ·  today ${sign}${formatMoney(todayEarnings)}`;
    }
  }

  setTasks(tasks: Ticket[]): void {
    if (!this.taskEl) return;
    const lines = tasks.map((t) => {
      const mark = t.status === "done" ? "[x]" : t.status === "doing" ? "[~]" : "[ ]";
      return `${mark} ${t.id} ${t.title}\n    ${workerById(t.owner).name} — ${t.note || t.status}`;
    });
    this.taskEl.textContent = lines.join("\n") || "(no tickets yet)";
  }

  setWatercooler(posts: WatercoolerPost[]): void {
    if (!this.coolerEl) return;
    const lines = posts.slice(-40).map((p) => `${p.time} ${workerById(p.from).name}:\n${p.text}`);
    this.coolerEl.textContent = lines.join("\n") || "(quiet)";
    this.coolerEl.scrollTop = this.coolerEl.scrollHeight;
  }

  setMeeting(title: string | null): void {
    if (!this.meetingEl) return;
    if (!title) {
      this.meetingEl.hidden = true;
      this.meetingEl.textContent = "";
      return;
    }
    this.meetingEl.hidden = false;
    this.meetingEl.textContent = title;
  }

  setStatus(text: string, ok = true): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.style.color = ok ? "#3cff6e" : "#ffb000";
  }

  inspect(id: AgentId, status: string, queue: Ticket[] = []): void {
    if (!this.inspectEl) return;
    const w = workerById(id);
    const q =
      queue
        .filter((t) => t.status !== "done")
        .map((t) => `${t.status === "doing" ? "~" : " "} ${t.id} ${t.title}`)
        .join("\n") || "queue empty";
    this.inspectEl.textContent = `${w.name.toUpperCase()}  ·  ${w.role}\n${w.style}\n${status}\n${q}`;
  }

  celebrate(): void {
    if (!this.stampEl) return;
    this.stampEl.hidden = false;
    this.stampEl.classList.remove("hud-stamp-play");
    void this.stampEl.offsetWidth;
    this.stampEl.classList.add("hud-stamp-play");
    this.setStatus(`${this.lastClock}  CLOSE STAMPED — QUARTERLY REVIEW`);
    window.setTimeout(() => {
      if (this.stampEl) {
        this.stampEl.hidden = true;
        this.stampEl.classList.remove("hud-stamp-play");
      }
    }, 2600);
  }

  private syncToCanvas(): void {
    const game = document.getElementById("game");
    const canvas = this.scene.game.canvas;
    if (!game || !canvas || !this.host || !this.inner) return;
    const gr = game.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    this.host.style.left = `${cr.left - gr.left}px`;
    this.host.style.top = `${cr.top - gr.top}px`;
    this.host.style.width = `${cr.width}px`;
    this.host.style.height = `${cr.height}px`;
    this.inner.style.transform = `scale(${cr.width / 1280}, ${cr.height / 720})`;
  }
}
