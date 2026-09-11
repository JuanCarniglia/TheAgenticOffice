import Phaser from "phaser";
import { bootBeep } from "../audio.js";
import { fetchLockedOptions, loadSettings } from "../settingsStore.js";
import { COLORS, FONT_BODY, FONT_PIXEL } from "../style.js";

export class IntroScene extends Phaser.Scene {
  constructor() {
    super("Intro");
  }

  create(): void {
    void fetchLockedOptions();
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    const bootLines = [
      "MEM CHECK........... 640K OK",
      "DETECTING AGENTS.... 5 FOUND",
      "MOUNTING FLOORPLAN.. OK",
      "HARNESS PORT 8787... READY",
    ];
    const bootText = this.add.text(40, 40, "", {
      fontFamily: FONT_PIXEL,
      fontSize: "12px",
      color: "#3cff6e",
      lineSpacing: 8,
    });

    let shown = 0;
    this.time.addEvent({
      delay: 180,
      repeat: bootLines.length - 1,
      callback: () => {
        shown += 1;
        bootText.setText(bootLines.slice(0, shown).join("\n"));
      },
    });

    this.time.delayedCall(900, () => {
      this.add
        .text(width / 2, height / 2 - 48, "THE AGENTIC OFFICE", {
          fontFamily: FONT_PIXEL,
          fontSize: "22px",
          color: "#f0e6c8",
          align: "center",
        })
        .setOrigin(0.5);

      this.add
        .text(width / 2, height / 2 - 8, "A paper company run by machines", {
          fontFamily: FONT_BODY,
          fontSize: "28px",
          color: "#d4a017",
        })
        .setOrigin(0.5);

      this.add
        .text(width / 2, height / 2 - 8, "by Juan Carniglia", {
          fontFamily: FONT_BODY,
          fontSize: "28px",
          color: "#d4a017",
        })
        .setOrigin(0.0, -0.6);

      const blink = this.add
        .text(width / 2, height / 2 + 48, "CLICK TO START", {
          fontFamily: FONT_PIXEL,
          fontSize: "12px",
          color: "#3cff6e",
        })
        .setOrigin(0.5, -2);

      this.tweens.add({
        targets: blink,
        alpha: 0.15,
        duration: 420,
        yoyo: true,
        repeat: -1,
      });

      this.add
        .text(width / 2, height - 28, "v1.0  ·  BIRD'S-EYE BRANCH  ·  EST. 2026", {
          fontFamily: FONT_PIXEL,
          fontSize: "10px",
          color: "#c4b48a",
        })
        .setOrigin(0.5);

      bootBeep(loadSettings().sound);
    });

    this.input.once("pointerdown", () => this.scene.start("Settings"));
    this.input.keyboard?.once("keydown", () => this.scene.start("Settings"));
  }
}
