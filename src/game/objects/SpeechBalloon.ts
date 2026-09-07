import Phaser from "phaser";
import { COLORS, FONT_BODY } from "../style.js";
import { charsRevealed, thinkDelayMs, typeDurationMs } from "../typewriter.js";

const WRAP = 210;
const MAX_W = 230;
const MAX_H = 110;

export class SpeechBalloon extends Phaser.GameObjects.Container {
  private readonly bubble: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private expiresAt = 0;
  private whisper = false;
  asking = false;
  private followX = 0;
  private followY = 0;
  private fullText = "";
  private thinkUntil = 0;
  private typeStarted = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.bubble = scene.add.graphics();
    this.label = scene.add.text(0, 0, "", {
      fontFamily: FONT_BODY,
      fontSize: "20px",
      color: "#111111",
      wordWrap: { width: WRAP },
      align: "center",
      lineSpacing: -1,
    });
    this.label.setOrigin(0.5, 1);
    this.label.setPadding(0, 0, 0, 0);
    this.add([this.bubble, this.label]);
    this.setVisible(false);
    scene.add.existing(this);
  }

  show(text: string, ask: boolean, durationMs = 5200, whisper = false): void {
    this.asking = ask;
    this.whisper = whisper;
    const clipped = text.length > 140 ? `${text.slice(0, 137)}…` : text;
    const shown = whisper ? `DM  ${clipped}` : clipped;
    this.label.setFontSize(20);
    const wrap = Math.min(WRAP, Math.max(56, shown.length * 10));
    this.label.setWordWrapWidth(wrap);
    this.fullText = shown;
    this.label.setText("…");
    if (this.label.height > MAX_H) {
      this.label.setFontSize(17);
    }
    const now = performance.now();
    this.thinkUntil = now + thinkDelayMs(shown);
    this.typeStarted = this.thinkUntil;
    this.expiresAt = ask
      ? Number.POSITIVE_INFINITY
      : this.typeStarted + typeDurationMs(shown) + durationMs;
    this.redraw();
    this.setVisible(true);
  }

  hide(): void {
    this.asking = false;
    this.setVisible(false);
    this.expiresAt = 0;
    this.fullText = "";
  }

  follow(x: number, y: number): void {
    this.followX = x;
    this.followY = y - 28;
    // Wall-clock bob — not Phaser time, not sim speed, not camera zoom.
    const bob = Math.sin(performance.now() / 420) * 1.1;
    this.setPosition(this.followX, this.followY + bob);
  }

  tick(): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now < this.thinkUntil) {
      if (this.label.text !== "…") {
        this.label.setText("…");
        this.redraw();
      }
      return;
    }
    const n = charsRevealed(this.fullText, now - this.typeStarted);
    const shown = this.fullText.slice(0, Math.max(1, n)) || "…";
    if (this.label.text !== shown) {
      this.label.setText(shown);
      this.redraw();
    }
    if (this.asking) return;
    if (now >= this.expiresAt) this.hide();
  }

  private redraw(): void {
    const padX = 10;
    const padY = 7;
    const w = Math.min(MAX_W, Math.max(44, this.label.width + padX * 2));
    const h = Math.min(MAX_H + 12, Math.max(28, this.label.height + padY * 2));
    this.bubble.clear();
    this.bubble.fillStyle(this.whisper ? 0xd6e4f0 : COLORS.balloon, 0.97);
    this.bubble.lineStyle(2, this.whisper ? 0x1e3a8a : 0x1a1814, 1);
    this.bubble.fillRoundedRect(-w / 2, -h - 8, w, h, 5);
    this.bubble.strokeRoundedRect(-w / 2, -h - 8, w, h, 5);
    this.bubble.fillTriangle(-6, -8, 6, -8, 0, 2);
    this.bubble.lineBetween(-6, -8, 0, 2);
    this.bubble.lineBetween(6, -8, 0, 2);
    this.label.setPosition(0, -10);
  }
}
