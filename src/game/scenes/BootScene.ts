import Phaser from "phaser";
import { COLORS, FONT_PIXEL } from "../style.js";
import { registerWorkerTextures } from "../sprites/pixelPeople.js";
import { registerFireTexture } from "../sprites/officeFire.js";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    const { width, height } = this.scale;
    const barBg = this.add.rectangle(width / 2, height / 2, 320, 18, 0x3a3428);
    const bar = this.add.rectangle(width / 2 - 156, height / 2, 4, 10, COLORS.gold).setOrigin(0, 0.5);
    this.add
      .text(width / 2, height / 2 - 28, "LOADING OFFICE…", {
        fontFamily: FONT_PIXEL,
        fontSize: "10px",
        color: "#f0e6c8",
      })
      .setOrigin(0.5);

    this.load.image("office", "/assets/office-floorplan.png");
    this.load.on("progress", (value: number) => {
      bar.width = 312 * value;
    });
    this.load.on("complete", () => {
      barBg.destroy();
      bar.destroy();
    });
  }

  async create(): Promise<void> {
    registerWorkerTextures(this);
    registerFireTexture(this);
    try {
      await document.fonts.ready;
    } catch {
      /* fonts optional */
    }
    this.time.delayedCall(280, () => this.scene.start("Intro"));
  }
}
