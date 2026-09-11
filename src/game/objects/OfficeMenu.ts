import type { AgentId } from "../../shared/types.js";
import { AGENT_IDS, workerById } from "../../shared/roster.js";
import { formatMoney, formatTokenCost, formatTokens, tokenSpendUsd, type StockSku } from "../../shared/catalog.js";

type PopupKind = "stock" | "who" | "books";

export class OfficeMenu {
  constructor(private readonly onMainMenu?: () => void) {}

  private host: HTMLDivElement | null = null;
  private popup: HTMLDivElement | null = null;
  private stock: StockSku[] = [];
  private balance = 0;
  private todayEarnings = 0;
  private todayTokens = 0;
  private lastLiveTokens = 0;
  private lastTrace = new Map<AgentId, string>();
  private activity = new Map<AgentId, string>();
  private whoId: AgentId = "jim";
  private openKind: PopupKind | null = null;

  mount(): void {
    this.unmount();
    const game = document.getElementById("game");
    if (!game) return;
    const bar = document.createElement("div");
    bar.id = "office-menu";
    bar.style.cssText = [
      "position:absolute",
      "top:8px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:26",
      "display:flex",
      "gap:6px",
      "font-family:VT323,monospace",
      "font-size:18px",
    ].join(";");
    bar.innerHTML = `
      <button data-kind="stock" type="button">STOCK</button>
      <button data-kind="who" type="button">WHO'S UP</button>
      <button data-kind="books" type="button">BOOKS</button>
      <button data-nav="menu" type="button">MENU</button>
    `;
    for (const btn of bar.querySelectorAll<HTMLButtonElement>("button")) {
      btn.style.cssText =
        "font:inherit;padding:2px 10px;background:#c3c3c3;border:2px solid #fff;border-right-color:#404040;border-bottom-color:#404040;cursor:pointer;";
      if (btn.dataset.nav === "menu") {
        btn.addEventListener("click", () => this.onMainMenu?.());
        continue;
      }
      btn.addEventListener("click", () => {
        const kind = btn.dataset.kind as PopupKind;
        this.toggle(kind);
      });
    }
    game.appendChild(bar);
    this.host = bar;
  }

  setStock(items: StockSku[]): void {
    this.stock = items.map((s) => ({ ...s }));
    if (this.openKind === "stock") this.renderPopup("stock");
  }

  setBooks(balance: number, todayEarnings: number, todayTokens = 0, lastLiveTokens?: number): void {
    this.balance = balance;
    this.todayEarnings = todayEarnings;
    this.todayTokens = todayTokens;
    if (lastLiveTokens != null) this.lastLiveTokens = lastLiveTokens;
    if (this.openKind === "books") this.renderPopup("books");
  }

  setTrace(id: AgentId, tool: string, summary: string, tokens?: number): void {
    this.lastTrace.set(id, `${tool} — ${summary}`);
    this.setActivity(id, `${tool}: ${summary}`);
    if (tokens != null) this.lastLiveTokens = tokens;
    if (this.openKind === "who" && this.whoId === id) this.renderPopup("who");
    if (tokens != null && this.openKind === "books") this.renderPopup("books");
  }

  setActivity(id: AgentId, status: string): void {
    this.activity.set(id, status);
    if (this.openKind === "who" && this.whoId === id) {
      const el = this.popup?.querySelector("#who-status");
      if (el) el.textContent = status;
    }
  }

  unmount(): void {
    this.closePopup();
    this.host?.remove();
    this.host = null;
  }

  private toggle(kind: PopupKind): void {
    if (this.openKind === kind) {
      this.closePopup();
      return;
    }
    this.renderPopup(kind);
  }

  private closePopup(): void {
    this.popup?.remove();
    this.popup = null;
    this.openKind = null;
  }

  private renderPopup(kind: PopupKind): void {
    const game = document.getElementById("game");
    if (!game) return;
    this.closePopup();
    this.openKind = kind;
    const box = document.createElement("div");
    box.style.cssText = [
      "position:absolute",
      "top:42px",
      "left:50%",
      "transform:translateX(-50%)",
      "width:min(520px, calc(100% - 32px))",
      "max-height:min(420px, 70%)",
      "overflow:auto",
      "z-index:27",
      "background:#e8e0cc",
      "border:2px solid #fff",
      "border-right-color:#404040",
      "border-bottom-color:#404040",
      "font-family:VT323,monospace",
      "font-size:18px",
      "color:#111",
      "box-shadow:4px 4px 0 #00000055",
    ].join(";");
    const title =
      kind === "stock" ? "WAREHOUSE STOCK" : kind === "who" ? "WHO'S UP" : "COMPANY BOOKS";
    box.innerHTML = `
      <div style="display:flex;align-items:center;background:#000080;color:#fff;padding:3px 8px;">
        <div style="flex:1;">${title}</div>
        <button id="menu-close" type="button" style="font:inherit;width:22px;padding:0;">X</button>
      </div>
      <div id="menu-body" style="padding:8px 10px;"></div>
    `;
    game.appendChild(box);
    this.popup = box;
    box.querySelector("#menu-close")?.addEventListener("click", () => this.closePopup());
    const body = box.querySelector("#menu-body");
    if (!body) return;
    if (kind === "stock") body.innerHTML = this.stockHtml();
    if (kind === "books") body.innerHTML = this.booksHtml();
    if (kind === "who") {
      body.innerHTML = this.whoHtml();
      body.querySelector("#who-select")?.addEventListener("change", (e) => {
        const v = (e.target as HTMLSelectElement).value as AgentId;
        if (AGENT_IDS.includes(v)) {
          this.whoId = v;
          this.renderPopup("who");
        }
      });
    }
  }

  private stockHtml(): string {
    const rows = this.stock
      .map((s) => {
        const low = s.qty <= s.reorderAt;
        const bg = low ? "background:#f3d0d0;" : "";
        const incoming = s.incoming > 0 ? ` +${s.incoming} inbound` : "";
        return `<tr style="${bg}">
          <td>${s.article} ${s.gsm}g ${s.size}</td>
          <td>${s.qty} / ${s.startQty} ${s.unit}${incoming}</td>
          <td>${s.reorderAt}</td>
          <td>${formatMoney(s.price)}</td>
          <td>${low ? "LOW" : "ok"}</td>
        </tr>`;
      })
      .join("");
    return `
      <table style="width:100%;border-collapse:collapse;font-size:16px;">
        <thead>
          <tr style="text-align:left;color:#000066;">
            <th>Article</th><th>On hand</th><th>Min</th><th>Price</th><th></th>
          </tr>
        </thead>
        <tbody>${rows || "<tr><td colspan='5'>No stock loaded.</td></tr>"}</tbody>
      </table>
    `;
  }

  private booksHtml(): string {
    const sign = this.todayEarnings >= 0 ? "+" : "";
    const spend = tokenSpendUsd(this.todayTokens);
    return `
      <div style="font-size:22px;color:#000066;">Current balance</div>
      <div style="font-size:28px;margin:4px 0 12px;">${formatMoney(this.balance)}</div>
      <div style="font-size:22px;color:#000066;">Earnings today</div>
      <div style="font-size:28px;margin:4px 0 12px;">${sign}${formatMoney(this.todayEarnings)}</div>
      <div style="font-size:22px;color:#000066;">Tokens today</div>
      <div style="font-size:28px;margin:4px 0 4px;">${formatTokens(this.todayTokens)}</div>
      <div style="font-size:16px;color:#444;margin-bottom:12px;">$0.25 per million tokens</div>
      <div style="font-size:22px;color:#000066;">Token spend today</div>
      <div style="font-size:28px;">${formatTokenCost(spend)}</div>
      <div style="font-size:22px;color:#000066;margin-top:12px;">Last live turn</div>
      <div style="font-size:22px;">${this.lastLiveTokens ? `${formatTokens(this.lastLiveTokens)} tok` : "(none yet)"}</div>
    `;
  }

  private whoHtml(): string {
    const opts = AGENT_IDS.map((id) => {
      const sel = id === this.whoId ? " selected" : "";
      return `<option value="${id}"${sel}>${workerById(id).name} — ${workerById(id).role}</option>`;
    }).join("");
    const w = workerById(this.whoId);
    const status = this.activity.get(this.whoId) || "at desk";
    return `
      <label>Agent
        <select id="who-select" style="font:inherit;margin-left:8px;">${opts}</select>
      </label>
      <div style="margin-top:10px;background:#fffdf6;border:2px inset #808080;padding:8px;">
        <div style="color:#000066;">${w.name.toUpperCase()} · ${w.role}</div>
        <div id="who-status" style="margin-top:6px;">${escapeHtml(status)}</div>
        <div style="margin-top:8px;color:#000066;">Last tool</div>
        <div>${escapeHtml(this.lastTrace.get(this.whoId) || "(none)")}</div>
      </div>
    `;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
