import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene.js";
import { IntroScene } from "./scenes/IntroScene.js";
import { SettingsScene } from "./scenes/SettingsScene.js";
import { OfficeScene } from "./scenes/OfficeScene.js";
import { COLORS } from "./style.js";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: COLORS.bg,
  pixelArt: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  scene: [BootScene, IntroScene, SettingsScene, OfficeScene],
});

void game;
