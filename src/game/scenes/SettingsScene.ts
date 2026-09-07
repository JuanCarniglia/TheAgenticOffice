import Phaser from "phaser";
import { COMPANY_GOALS, type Provider, type SimSpeed } from "../../shared/types.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GameSettings } from "../settingsStore.js";
import { HUMAN_MAX_CHARS, screenHumanText } from "../../shared/guardrails.js";
import { beep } from "../audio.js";
import { COLORS, FONT_BODY, FONT_PIXEL } from "../style.js";

const PROVIDERS: Provider[] = ["mock", "openai", "anthropic", "cursor"];
const SPEEDS: SimSpeed[] = ["slow", "normal", "fast"];
const MODELS: Record<Provider, string> = {
  mock: "scripted-office",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-0",
  cursor: "composer-2.5",
};

export class SettingsScene extends Phaser.Scene {
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private form: HTMLDivElement | null = null;

  constructor() {
    super("Settings");
  }

  create(): void {
    this.settings = loadSettings();
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.add
      .text(width / 2, 48, "MINIMUM SETTINGS", {
        fontFamily: FONT_PIXEL,
        fontSize: "14px",
        color: "#f0e6c8",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 76, "API keys stay in the harness .env — never in the browser.", {
        fontFamily: FONT_BODY,
        fontSize: "20px",
        color: "#8a7d62",
      })
      .setOrigin(0.5);

    this.mountForm();

    const start = this.add
      .text(width / 2, height - 64, "[ OPEN OFFICE ]", {
        fontFamily: FONT_PIXEL,
        fontSize: "12px",
        color: "#3cff6e",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    start.on("pointerdown", () => this.commit(true));
    this.input.keyboard?.on("keydown-ENTER", () => this.commit(true));
    this.input.keyboard?.on("keydown-ESC", () => this.scene.start("Intro"));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unmountForm());
  }

  private mountForm(): void {
    this.unmountForm();
    const host = document.getElementById("game");
    if (!host) return;

    const box = document.createElement("div");
    box.id = "office-settings";
    box.style.cssText = [
      "position:absolute",
      "left:50%",
      "top:118px",
      "transform:translateX(-50%)",
      "width:560px",
      "background:#c3c3c3",
      "border:2px solid #fff",
      "border-right-color:#404040",
      "border-bottom-color:#404040",
      "box-shadow:4px 4px 0 #000",
      "font-family:VT323,monospace",
      "color:#1a1814",
      "z-index:8",
    ].join(";");

    box.innerHTML = `
      <div style="background:#000080;color:#fff;padding:6px 10px;font-family:'Press Start 2P',monospace;font-size:9px;">
        SETTINGS.EXE
      </div>
      <div style="padding:14px 16px 10px;display:grid;gap:10px;font-size:22px;">
        <label>Provider
          <select id="s-provider" style="width:100%;font:inherit;padding:4px;">
            ${PROVIDERS.map((p) => `<option value="${p}">${p.toUpperCase()}</option>`).join("")}
          </select>
        </label>
        <label>Model
          <input id="s-model" style="width:100%;font:inherit;padding:4px;box-sizing:border-box;" />
        </label>
        <label>Company goal
          <select id="s-goal-pick" style="width:100%;font:inherit;padding:4px;">
            ${COMPANY_GOALS.map((g) => `<option value="${g.id}">${g.label}</option>`).join("")}
            <option value="custom">Custom…</option>
          </select>
        </label>
        <div id="s-goal-preview" style="font-size:18px;color:#404040;line-height:1.25;"></div>
        <textarea id="s-goal" rows="2" maxlength="${HUMAN_MAX_CHARS}" style="width:100%;font:inherit;padding:4px;box-sizing:border-box;resize:vertical;display:none;" placeholder="One short paper-company sentence"></textarea>
        <div id="s-goal-hint" style="font-size:16px;color:#8b1e1e;"></div>
        <div style="display:flex;gap:18px;">
          <label>Sound
            <select id="s-sound" style="font:inherit;padding:4px;">
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </label>
          <label>Sim speed
            <select id="s-speed" style="font:inherit;padding:4px;">
              ${SPEEDS.map((s) => `<option value="${s}">${s.toUpperCase()}</option>`).join("")}
            </select>
          </label>
        </div>
        <div style="font-size:18px;color:#404040;line-height:1.2;">
          Paper-company only. Sim speed is a real tick delay (Normal ≈ 2s). Live models add extra wait on top. Keys stay in the harness .env.
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="s-back" type="button" style="font:inherit;padding:4px 10px;">Back</button>
          <button id="s-open" type="button" style="font:inherit;padding:4px 10px;background:#000080;color:#fff;border:2px outset #808080;">
            Open Office
          </button>
        </div>
      </div>
    `;

    host.appendChild(box);
    this.form = box;

    const provider = box.querySelector<HTMLSelectElement>("#s-provider")!;
    const model = box.querySelector<HTMLInputElement>("#s-model")!;
    const pick = box.querySelector<HTMLSelectElement>("#s-goal-pick")!;
    const goal = box.querySelector<HTMLTextAreaElement>("#s-goal")!;
    const sound = box.querySelector<HTMLSelectElement>("#s-sound")!;
    const speed = box.querySelector<HTMLSelectElement>("#s-speed")!;

    const matched = COMPANY_GOALS.find((g) => g.text === this.settings.goal);
    pick.value = matched?.id ?? "custom";
    provider.value = this.settings.provider;
    model.value = this.settings.model;
    goal.value = this.settings.goal;
    sound.value = this.settings.sound ? "on" : "off";
    speed.value = this.settings.speed;
    this.syncGoalField(pick, goal, box.querySelector<HTMLDivElement>("#s-goal-preview"));

    provider.addEventListener("change", () => {
      const next = provider.value as Provider;
      if (!model.value || Object.values(MODELS).includes(model.value)) {
        model.value = MODELS[next];
      }
    });
    pick.addEventListener("change", () => {
      this.syncGoalField(pick, goal, box.querySelector<HTMLDivElement>("#s-goal-preview"));
    });
    box.querySelector("#s-open")?.addEventListener("click", () => this.commit(true));
    box.querySelector("#s-back")?.addEventListener("click", () => {
      this.commit(false);
      this.scene.start("Intro");
    });
  }

  private syncGoalField(
    pick: HTMLSelectElement,
    goal: HTMLTextAreaElement,
    preview: HTMLDivElement | null,
  ): void {
    const preset = COMPANY_GOALS.find((g) => g.id === pick.value);
    const custom = !preset;
    goal.style.display = custom ? "block" : "none";
    if (preset) goal.value = preset.text;
    if (preview) preview.textContent = custom ? "Write a short paper-company goal." : preset.text;
  }

  private readGoal(): string {
    if (!this.form) return this.settings.goal;
    const pick = this.form.querySelector<HTMLSelectElement>("#s-goal-pick")!.value;
    const preset = COMPANY_GOALS.find((g) => g.id === pick);
    if (preset) return preset.text;
    return this.form.querySelector<HTMLTextAreaElement>("#s-goal")!.value.trim() || DEFAULT_SETTINGS.goal;
  }

  private readForm(): GameSettings {
    if (!this.form) return this.settings;
    const provider = this.form.querySelector<HTMLSelectElement>("#s-provider")!.value as Provider;
    return {
      provider,
      model: this.form.querySelector<HTMLInputElement>("#s-model")!.value.trim() || MODELS[provider],
      goal: this.readGoal(),
      sound: this.form.querySelector<HTMLSelectElement>("#s-sound")!.value === "on",
      speed: this.form.querySelector<HTMLSelectElement>("#s-speed")!.value as SimSpeed,
    };
  }

  private commit(openOffice: boolean): void {
    this.settings = this.readForm();
    const hint = this.form?.querySelector<HTMLDivElement>("#s-goal-hint");
    const goalCheck = screenHumanText(this.settings.goal, { channel: "goal" });
    if (!goalCheck.ok) {
      if (hint) hint.textContent = goalCheck.reply;
      return;
    }
    if (hint) hint.textContent = "";
    this.settings.goal = goalCheck.text;
    saveSettings(this.settings);
    beep(this.settings.sound, 660, 60);
    if (openOffice) this.scene.start("Office");
  }

  private unmountForm(): void {
    this.form?.remove();
    this.form = null;
  }
}
