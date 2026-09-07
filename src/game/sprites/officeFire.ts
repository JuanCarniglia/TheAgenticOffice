import Phaser from "phaser";

const FRAMES = [
  [
    "....rr....",
    "...ryrr...",
    "..rryyrr..",
    "..rywyyrr.",
    ".rryywyrr.",
    ".rryyyyrr.",
    "..rryyrr..",
    "...rrrr...",
    "....kk....",
    "....kk....",
  ],
  [
    "...rr.r...",
    "..rryrr...",
    ".rryyyrr..",
    ".ryywyyrr.",
    ".rrywyyrr.",
    "..ryyyyrr.",
    "..rryyrr..",
    "...rrrr...",
    "....kk....",
    "...kkk....",
  ],
  [
    "....r.r...",
    "...ryrr...",
    "..rryyrr..",
    ".rrywyyrr.",
    ".ryywyyrr.",
    ".rryyyyrr.",
    "..rryrrr..",
    "...rrrr...",
    "....kk....",
    "....kk....",
  ],
  [
    "...r.rr...",
    "..rryrr...",
    ".rryyyrr..",
    ".ryyywyrr.",
    "..rywyyrr.",
    "..ryyyyrr.",
    "...ryyrr..",
    "...rrrr...",
    "....kk....",
    "....kk....",
  ],
];

const PALETTE: Record<string, number> = {
  r: 0xc4281c,
  y: 0xf2a20d,
  w: 0xfff4c2,
  k: 0x3a2418,
};

const SCALE = 3;
const FW = 10;
const FH = 10;

export function registerFireTexture(scene: Phaser.Scene): void {
  const canvas = document.createElement("canvas");
  canvas.width = FW * SCALE * FRAMES.length;
  canvas.height = FH * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  FRAMES.forEach((rows, fi) => {
    ctx.save();
    ctx.translate(fi * FW * SCALE, 0);
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const color = PALETTE[row[x]];
        if (color === undefined) continue;
        ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
    ctx.restore();
  });
  if (scene.textures.exists("office-fire")) scene.textures.remove("office-fire");
  scene.textures.addCanvas("office-fire", canvas);
  const tex = scene.textures.get("office-fire");
  for (let i = 0; i < FRAMES.length; i++) {
    tex.add(String(i), 0, i * FW * SCALE, 0, FW * SCALE, FH * SCALE);
  }
}

export function ensureFireAnim(scene: Phaser.Scene): void {
  if (scene.anims.exists("office-fire")) return;
  scene.anims.create({
    key: "office-fire",
    frames: [0, 1, 2, 3, 2, 1].map((n) => ({ key: "office-fire", frame: String(n) })),
    frameRate: 10,
    repeat: -1,
  });
}
