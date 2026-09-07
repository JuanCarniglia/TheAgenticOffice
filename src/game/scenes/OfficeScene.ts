import Phaser from "phaser";
import type { AgentId, OfficeEvent, Ticket, WatercoolerPost, ZoneId } from "../../shared/types.js";
import { AGENT_IDS, isSales, workerById } from "../../shared/roster.js";
import { zoneWorldPos, worldToNorm, ZONES } from "../layout.js";
import { loadSettings } from "../settingsStore.js";
import { beep, phoneHangup, phonePickup, phoneTransfer, ringBell, ringPhone } from "../audio.js";
import { OfficeClient } from "../net/OfficeClient.js";
import { Hud } from "../objects/Hud.js";
import { WorkerSprite } from "../objects/WorkerSprite.js";
import { CustomerChat } from "../objects/CustomerChat.js";
import { OfficeMenu } from "../objects/OfficeMenu.js";
import { FONT_PIXEL } from "../style.js";
import { ensureFireAnim } from "../sprites/officeFire.js";
import { officeLog, summarizeEvent } from "../../shared/trace.js";
import { HUMAN_MAX_CHARS, screenHumanText } from "../../shared/guardrails.js";

export class OfficeScene extends Phaser.Scene {
  private client: OfficeClient | null = null;
  private workers = new Map<AgentId, WorkerSprite>();
  private tasks: Ticket[] = [];
  private queues = new Map<AgentId, Ticket[]>();
  private cooler: WatercoolerPost[] = [];
  private hud!: Hud;
  private map!: Phaser.GameObjects.Image;
  private selected: AgentId | null = null;
  private replyHost: HTMLDivElement | null = null;
  private pendingAsk: { agentId: AgentId; requestId: string; question: string } | null = null;
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private camTx = 0;
  private camTy = 0;
  private camTz = 1;
  private chat: CustomerChat | null = null;
  private menu: OfficeMenu | null = null;
  private fire: Phaser.GameObjects.Sprite | null = null;

  constructor() {
    super("Office");
  }

  create(): void {
    const settings = loadSettings();
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x2a2a2e);

    this.map = this.add.image(0, 0, "office").setOrigin(0.5);
    const fit = Math.min((width - 40) / this.map.width, (height - 80) / this.map.height);
    this.map.setScale(fit);
    this.map.setPosition(width / 2 - 40, height / 2 + 8);

    const debug = new URLSearchParams(location.search).has("debug");
    if (debug) {
      for (const [id, zone] of Object.entries(ZONES)) {
        const p = zoneWorldPos(id as ZoneId, this.map);
        this.add.circle(p.x, p.y, 5, 0xff3333, 0.85).setDepth(3000);
        this.add
          .text(p.x, p.y + 8, zone.label, {
            fontFamily: FONT_PIXEL,
            fontSize: "6px",
            color: "#8b1e1e",
          })
          .setOrigin(0.5, 0)
          .setDepth(3000);
      }
    }

    for (const id of AGENT_IDS) {
      const worker = new WorkerSprite(this, id, workerById(id).home, this.map);
      worker.sprite.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        this.select(id);
      });
      this.workers.set(id, worker);
    }

    this.hud = new Hud(this);
    this.hud.mount();
    this.hud.setGoal(settings.goal);
    this.hud.setBooks(6000, 0);
    this.hud.setStatus("OFFICE NETWORK: CONNECTING…", false);

    this.menu = new OfficeMenu(() => this.goMainMenu());
    this.menu.mount();
    this.menu.setBooks(6000, 0);
    for (const id of AGENT_IDS) this.menu.setActivity(id, "at desk");

    const mapLeft = this.map.x - this.map.displayWidth / 2;
    const mapTop = this.map.y - this.map.displayHeight / 2;
    this.cameras.main.setBounds(mapLeft, mapTop, this.map.displayWidth, this.map.displayHeight);
    this.camTz = this.mapMinZoom();
    this.cameras.main.setZoom(this.camTz);
    this.cameras.main.centerOn(this.map.x, this.map.y);
    this.camTx = this.cameras.main.scrollX;
    this.camTy = this.cameras.main.scrollY;
    this.clampCam();

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) {
        this.dragging = true;
        this.lastPtr = { x: pointer.x, y: pointer.y };
      }
      if (debug && this.map.getBounds().contains(pointer.worldX, pointer.worldY)) {
        const n = worldToNorm(pointer.worldX, pointer.worldY, this.map);
        console.info(`zone click  nx: ${n.nx.toFixed(3)}  ny: ${n.ny.toFixed(3)}`);
      }
    });
    this.input.on("pointerup", () => {
      this.dragging = false;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.camTx -= (pointer.x - this.lastPtr.x) / this.camTz;
      this.camTy -= (pointer.y - this.lastPtr.y) / this.camTz;
      this.lastPtr = { x: pointer.x, y: pointer.y };
      this.clampCam();
    });
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _g: unknown, _dx: number, dy: number) => {
      const factor = dy > 0 ? 0.96 : 1.04;
      this.camTz = Phaser.Math.Clamp(this.camTz * factor, this.mapMinZoom(), 2.8);
      this.clampCam();
    });

    this.client = new OfficeClient();
    this.client.onEvent((ev) => this.onOfficeEvent(ev));
    this.client.connect();
    this.client.send({
      type: "start",
      goal: settings.goal,
      provider: settings.provider,
      model: settings.model,
      speed: settings.speed,
    });

    this.chat = new CustomerChat(
      (to, text) => {
        this.client?.send({ type: "customer_say", to, text });
      },
      (to) => {
        this.client?.send({ type: "dial", to });
      },
      () => {
        this.client?.send({ type: "hangup" });
      },
    );
    this.chat.mount();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  update(time: number, delta: number): void {
    for (const worker of this.workers.values()) worker.update(time, delta);
    const ease = 1 - Math.pow(0.0007, delta / 1000);
    this.clampCam();
    this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, this.camTx, ease);
    this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, this.camTy, ease);
    this.cameras.main.zoom = Phaser.Math.Linear(this.cameras.main.zoom, this.camTz, ease);
    if (this.client && !this.pendingAsk) {
      const live = this.client.connected;
      if (!live) this.hud.setStatus("OFFICE NETWORK: WAITING FOR HARNESS…", false);
    }
  }

  private onOfficeEvent(event: OfficeEvent): void {
    officeLog("ui", summarizeEvent(event));
    const settings = loadSettings();
    switch (event.type) {
      case "session_started":
        this.hud.setGoal(event.goal);
        this.hud.setClock(event.clock, "LOG IN");
        this.hud.setBooks(event.balance, event.todayEarnings);
        this.tasks = event.tasks;
        this.hud.setTasks(this.tasks);
        this.queues = new Map(Object.entries(event.queues) as Array<[AgentId, Ticket[]]>);
        this.hud.setStatus(`OFFICE NETWORK: LIVE   ${event.clock}`);
        this.menu?.setBooks(event.balance, event.todayEarnings, event.todayTokens);
        this.menu?.setStock(event.stock);
        for (const [id, zone] of Object.entries(event.positions) as Array<[AgentId, ZoneId]>) {
          this.workers.get(id)?.moveTo(zone);
        }
        break;
      case "clock":
        this.hud.setClock(event.time, event.label);
        break;
      case "say":
        this.workers.get(event.agentId)?.say(event.text, false);
        beep(settings.sound, 480, 50);
        this.hud.inspect(event.agentId, event.text, this.queues.get(event.agentId) ?? []);
        this.noteActivity(event.agentId, `talking: ${event.text}`);
        break;
      case "whisper":
        this.workers.get(event.agentId)?.say(event.text, false, true);
        beep(settings.sound, 360, 40);
        this.hud.inspect(event.agentId, event.text, this.queues.get(event.agentId) ?? []);
        this.noteActivity(event.agentId, `DMing: ${event.text}`);
        break;
      case "watercooler":
        this.cooler.push({ id: `${event.time}-${event.from}`, from: event.from, text: event.text, time: event.time });
        this.hud.setWatercooler(this.cooler);
        break;
      case "dm":
        this.hud.inspect(event.to, `DM from ${event.from}: ${event.text}`, this.queues.get(event.to) ?? []);
        break;
      case "meeting_start":
        this.hud.setMeeting(`${event.title} — ${event.topic}`);
        break;
      case "meeting_say":
        this.workers.get(event.agentId)?.say(event.text, false);
        this.hud.inspect(event.agentId, event.text, this.queues.get(event.agentId) ?? []);
        this.noteActivity(event.agentId, `in standup: ${event.text}`);
        break;
      case "meeting_end":
        this.hud.setMeeting(null);
        break;
      case "customer_line": {
        const from = event.from === "you" ? "You" : workerById(event.from).name;
        this.chat?.addLine(from, event.text);
        if (event.from !== "you") {
          this.chat?.followSpeaker(event.from);
          this.chat?.expand({ dial: false });
          this.chat?.markOnLine();
          this.chat?.waiting(true);
          this.noteActivity(event.from, `on the phone: ${event.text}`);
        } else {
          this.chat?.waiting(false);
        }
        break;
      }
      case "ask_human":
        this.workers.get(event.agentId)?.say(event.question, true);
        beep(settings.sound, 720, 90);
        this.pendingAsk = event;
        this.showReply(event.agentId, event.requestId, event.question);
        this.hud.setStatus(`HQ INPUT NEEDED — ${event.agentId.toUpperCase()}`, false);
        break;
      case "move_to":
        this.workers.get(event.agentId)?.moveTo(event.zone);
        this.noteActivity(event.agentId, `walking to ${event.zone.replaceAll("_", " ")}`);
        break;
      case "task_update":
        this.tasks = this.tasks.map((t) => (t.id === event.task.id ? event.task : t));
        if (!this.tasks.some((t) => t.id === event.task.id)) this.tasks.push(event.task);
        this.hud.setTasks(this.tasks);
        break;
      case "tasks_replaced":
        this.tasks = event.tasks;
        this.hud.setTasks(this.tasks);
        break;
      case "status":
        {
          const w = this.workers.get(event.agentId);
          if (w) w.status = event.status;
          this.hud.inspect(event.agentId, event.status, this.queues.get(event.agentId) ?? []);
          this.noteActivity(event.agentId, event.status);
        }
        break;
      case "queue_update":
        this.queues.set(event.agentId, event.queue);
        break;
      case "books":
        this.hud.setBooks(event.balance, event.todayEarnings);
        this.menu?.setBooks(event.balance, event.todayEarnings, event.todayTokens);
        break;
      case "stock":
        this.menu?.setStock(event.items);
        break;
      case "sale":
        this.hud.setStatus(
          `SALE  ${event.qty} ${event.unit} ${event.label}  +$${event.revenue.toFixed(2)}`,
        );
        this.noteActivity(event.salesperson, `closed ${event.qty} ${event.unit} of ${event.label}`);
        if (event.revenue >= 100) {
          this.hud.setStatus(`SALE BELL  +$${event.revenue.toFixed(2)}`, true);
        }
        break;
      case "bell":
        ringBell(settings.sound);
        this.hud.setStatus("PAM RINGS THE BELL — $100 SALE");
        this.noteActivity("pam", "ringing the sales bell");
        break;
      case "phone":
        if (event.kind === "ring") {
          ringPhone(settings.sound);
          this.hud.setStatus("INBOUND CALL — PAM'S DESK", false);
          this.noteActivity("pam", "phone ringing");
          this.chat?.expand({ dial: false });
          this.chat?.markOnLine();
        } else if (event.kind === "pickup") {
          phonePickup(settings.sound);
          this.hud.setStatus("PAM PICKED UP");
          this.chat?.markOnLine();
        } else if (event.kind === "transfer") {
          phoneTransfer(settings.sound);
          this.hud.setStatus("TRANSFER");
        } else if (event.kind === "hangup") {
          phoneHangup(settings.sound);
          this.hud.setStatus("CALL ENDED");
          this.noteActivity("pam", "line disconnected");
          this.chat?.endCall();
        }
        break;
      case "fire":
        if (event.on) {
          this.showFire(event.zone);
          this.hud.setStatus("SMALL FIRE — DWIGHT IS ON IT", false);
        } else {
          this.hideFire();
          this.hud.setStatus("FIRE CONTAINED");
        }
        break;
      case "reorder_alert":
        this.hud.setStatus(
          `REORDER  ${event.label} at ${event.qty} ${event.unit} (min ${event.reorderAt})`,
          false,
        );
        this.noteActivity(
          "angela",
          `warehouse min: ${event.label} at ${event.qty} ${event.unit}`,
        );
        break;
      case "reordered":
        this.hud.setStatus(
          `RESTOCKED  ${event.qty} ${event.unit} ${event.label}  −$${event.cost.toFixed(2)}`,
        );
        this.noteActivity("pam", `reordered ${event.qty} ${event.unit} of ${event.label}`);
        break;
      case "goal_met":
        this.hud.celebrate();
        beep(settings.sound, 880, 160);
        break;
      case "tick":
        this.hud.setClock(event.time);
        if (!this.pendingAsk) this.hud.setStatus(`OFFICE NETWORK: LIVE   ${event.time}`);
        break;
      case "guardrail":
        this.hud.setStatus(`HOLD UP — ${event.reply}`, false);
        break;
      case "error":
        this.hud.setStatus(`HARNESS: ${event.message}`, false);
        break;
      default:
        break;
    }
  }

  private mapMinZoom(): number {
    const { width, height } = this.cameras.main;
    return Math.max(width / this.map.displayWidth, height / this.map.displayHeight);
  }

  private clampCam(): void {
    const z = this.camTz;
    const viewW = this.cameras.main.width / z;
    const viewH = this.cameras.main.height / z;
    const left = this.map.x - this.map.displayWidth / 2;
    const top = this.map.y - this.map.displayHeight / 2;
    const maxX = left + Math.max(0, this.map.displayWidth - viewW);
    const maxY = top + Math.max(0, this.map.displayHeight - viewH);
    this.camTx = Phaser.Math.Clamp(this.camTx, left, maxX);
    this.camTy = Phaser.Math.Clamp(this.camTy, top, maxY);
  }

  private noteActivity(id: AgentId, status: string): void {
    this.menu?.setActivity(id, status);
  }

  private select(id: AgentId): void {
    this.selected = id;
    for (const [wid, worker] of this.workers) worker.setSelected(wid === id);
    const w = this.workers.get(id);
    if (w) this.hud.inspect(id, w.status, this.queues.get(id) ?? []);
    if (isSales(id)) this.chat?.setCounterpart(id, true);
  }

  private showReply(agentId: AgentId, requestId: string, question: string): void {
    this.hideReply();
    const host = document.getElementById("game");
    if (!host) return;
    const box = document.createElement("div");
    box.id = "office-reply";
    box.style.cssText = [
      "position:absolute",
      "left:16px",
      "right:16px",
      "bottom:52px",
      "background:#c3c3c3",
      "border:2px solid #fff",
      "border-right-color:#404040",
      "border-bottom-color:#404040",
      "padding:10px 12px",
      "font-family:VT323,monospace",
      "font-size:22px",
      "color:#1a1814",
      "z-index:9",
      "display:flex",
      "flex-direction:column",
      "gap:6px",
    ].join(";");
    box.innerHTML = `
      <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:#000080;">
        REPLY TO ${agentId.toUpperCase()}
      </div>
      <div style="font-size:18px;color:#404040;">${escapeHtml(question)}</div>
      <div style="display:flex;gap:8px;">
        <span>&gt;</span>
        <input id="office-reply-input" maxlength="${HUMAN_MAX_CHARS}" placeholder="One short line…" style="flex:1;font:inherit;border:2px inset #808080;padding:2px 6px;" />
        <button id="office-reply-send" style="font:inherit;padding:2px 10px;">SEND</button>
      </div>
      <div id="office-reply-hint" style="font-size:16px;color:#8b1e1e;"></div>
    `;
    host.appendChild(box);
    this.replyHost = box;
    const input = box.querySelector<HTMLInputElement>("#office-reply-input")!;
    const hint = box.querySelector<HTMLDivElement>("#office-reply-hint")!;
    const send = () => {
      const text = input.value.trim();
      if (!text || !this.client) return;
      const verdict = screenHumanText(text, { channel: "hq", agentId });
      if (!verdict.ok) {
        hint.textContent = verdict.reply;
        this.hud.setStatus(`HOLD UP — ${verdict.reply}`, false);
        return;
      }
      this.client.send({ type: "human_reply", agentId, requestId, text: verdict.text });
      this.workers.get(agentId)?.clearAsk();
      this.pendingAsk = null;
      this.hideReply();
      this.hud.setStatus("OFFICE NETWORK: LIVE");
    };
    box.querySelector("#office-reply-send")?.addEventListener("click", send);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
    input.focus();
  }

  private hideReply(): void {
    this.replyHost?.remove();
    this.replyHost = null;
  }

  private showFire(zone: ZoneId): void {
    ensureFireAnim(this);
    const pos = zoneWorldPos(zone, this.map);
    if (!this.fire) {
      this.fire = this.add.sprite(pos.x, pos.y, "office-fire", "0");
      this.fire.setOrigin(0.5, 0.92);
    }
    this.fire.setPosition(pos.x, pos.y);
    this.fire.setDepth(pos.y + 30);
    this.fire.setVisible(true);
    this.fire.play("office-fire");
  }

  private hideFire(): void {
    this.fire?.anims.stop();
    this.fire?.setVisible(false);
  }

  private goMainMenu(): void {
    this.teardown();
    this.scene.start("Intro");
  }

  private teardown(): void {
    this.hideReply();
    this.hud.unmount();
    this.chat?.unmount();
    this.chat = null;
    this.menu?.unmount();
    this.menu = null;
    this.hideFire();
    this.fire?.destroy();
    this.fire = null;
    this.client?.close();
    this.client = null;
    for (const w of this.workers.values()) w.destroy();
    this.workers.clear();
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
