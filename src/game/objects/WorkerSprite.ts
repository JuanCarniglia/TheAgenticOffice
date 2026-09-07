import Phaser from "phaser";
import type { AgentId, ZoneId } from "../../shared/types.js";
import { workerById } from "../../shared/roster.js";
import { zoneWorldPos } from "../layout.js";
import { FONT_BODY } from "../style.js";
import { SpeechBalloon } from "./SpeechBalloon.js";

type Facing = "down" | "up" | "left" | "right";

export class WorkerSprite {
  readonly id: AgentId;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly nameTag: Phaser.GameObjects.Text;
  readonly balloon: SpeechBalloon;
  zone: ZoneId;
  status = "at desk";
  private target: { x: number; y: number } | null = null;

  constructor(
    scene: Phaser.Scene,
    id: AgentId,
    zone: ZoneId,
    private readonly map: Phaser.GameObjects.Image,
  ) {
    this.id = id;
    this.zone = zone;
    const pos = zoneWorldPos(zone, map, id);
    this.sprite = scene.add.sprite(pos.x, pos.y, `worker-${id}`, "down-0");
    this.sprite.setOrigin(0.5, 0.92);
    this.sprite.setDepth(pos.y);
    this.sprite.setInteractive({ useHandCursor: true });

    this.nameTag = scene.add.text(pos.x, pos.y + 4, workerById(id).name.toUpperCase(), {
      fontFamily: FONT_BODY,
      fontSize: "18px",
      color: "#111111",
      backgroundColor: "#fff8e8ee",
      padding: { x: 4, y: 1 },
      stroke: "#ffffff",
      strokeThickness: 2,
    });
    this.nameTag.setOrigin(0.5, 0);

    this.balloon = new SpeechBalloon(scene);
    this.balloon.setDepth(4000);
  }

  moveTo(zone: ZoneId): void {
    this.zone = zone;
    this.target = zoneWorldPos(zone, this.map, this.id);
    this.status = `walking to ${zone.replaceAll("_", " ")}`;
  }

  say(text: string, ask = false, whisper = false): void {
    this.balloon.show(text, ask, whisper ? 6400 : 5200, whisper);
    this.status = ask ? "waiting on HQ" : whisper ? "DMing" : "talking";
  }

  clearAsk(): void {
    if (this.balloon.asking) this.balloon.hide();
    this.status = "back at it";
  }

  update(time: number, delta: number): void {
    const speed = 70;
    if (this.target) {
      const dx = this.target.x - this.sprite.x;
      const dy = this.target.y - this.sprite.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1.2) {
        this.sprite.setPosition(this.target.x, this.target.y);
        this.target = null;
        this.status = `at ${this.zone.replaceAll("_", " ")}`;
        this.setFacing("down", 0);
      } else {
        const step = (speed * delta) / 1000;
        this.sprite.x += (dx / dist) * Math.min(step, dist);
        this.sprite.y += (dy / dist) * Math.min(step, dist);
        const facing: Facing =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        this.setFacing(facing, Math.floor(time / 180) % 2);
      }
    } else {
      this.setFacing("down", 0);
    }

    this.sprite.setDepth(this.sprite.y);
    this.nameTag.setPosition(this.sprite.x, this.sprite.y + 4);
    this.nameTag.setDepth(this.sprite.y + 1);
    this.balloon.follow(this.sprite.x, this.sprite.y - 8);
    this.balloon.tick();
  }

  setSelected(on: boolean): void {
    this.sprite.setTint(on ? 0xfff3b0 : 0xffffff);
  }

  destroy(): void {
    this.sprite.destroy();
    this.nameTag.destroy();
    this.balloon.destroy();
  }

  private setFacing(facing: Facing, frame: number): void {
    this.sprite.setFrame(`${facing}-${frame}`);
  }
}
