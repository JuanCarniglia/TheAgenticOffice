import Phaser from "phaser";
import type { AgentId } from "../../shared/types.js";

type Palette = {
  hair: number;
  skin: number;
  shirt: number;
  pants: number;
  accent: number;
  outline: number;
};

export const PALETTES: Record<AgentId, Palette> = {
  michael: {
    hair: 0x3b2414,
    skin: 0xf0c8a0,
    shirt: 0xf5f0e6,
    pants: 0x2a2f4a,
    accent: 0x1e3a8a,
    outline: 0x1a120c,
  },
  pam: {
    hair: 0x5a3a22,
    skin: 0xf2c4a8,
    shirt: 0xe8a090,
    pants: 0x2b2b2b,
    accent: 0xc4786a,
    outline: 0x1a120c,
  },
  jim: {
    hair: 0x4a3220,
    skin: 0xefc4a0,
    shirt: 0x7eb0d4,
    pants: 0xc4a46a,
    accent: 0x3a5a7a,
    outline: 0x1a120c,
  },
  dwight: {
    hair: 0x2a1c10,
    skin: 0xe8b890,
    shirt: 0xc4a04a,
    pants: 0x3a3a28,
    accent: 0x4a2a10,
    outline: 0x1a120c,
  },
  angela: {
    hair: 0xe8d48a,
    skin: 0xf3d0b4,
    shirt: 0x2a2a2a,
    pants: 0x6a6a72,
    accent: 0xd0d0d4,
    outline: 0x1a120c,
  },
};

const FRONT = [
  "..oooooooo..",
  ".ohhhhhhho.",
  ".ohhhhhhho.",
  ".ohsssssho.",
  "..osssssso..",
  "..os.ss.so..",
  "...osssso...",
  "..otttttto..",
  ".otttttttto.",
  ".otttattto.",
  ".otttttttto.",
  "..otttttto..",
  "..opp..ppo..",
  "..opp..ppo..",
  "..opp..ppo..",
  "..oaa..aao..",
];

const SIDE = [
  "...oooooo...",
  "..ohhhhhho..",
  "..ohhhhhho..",
  "..ohssssho..",
  "...osssso...",
  "...osssso...",
  "...osssso...",
  "..otttttto..",
  "..otttttto..",
  "..otttatto.",
  "..otttttto..",
  "...otttto...",
  "...opppo....",
  "...opppo....",
  "...opppo....",
  "...oaaoo....",
];

const BACK = [
  "..oooooooo..",
  ".ohhhhhhho.",
  ".ohhhhhhho.",
  ".ohhhhhhho.",
  "..ohhhhho..",
  "..ohhhhho..",
  "...ohhho....",
  "..otttttto..",
  ".otttttttto.",
  ".otttttttto.",
  ".otttttttto.",
  "..otttttto..",
  "..opp..ppo..",
  "..opp..ppo..",
  "..opp..ppo..",
  "..oaa..aao..",
];

const SCALE = 3;
const FW = 12;
const FH = 16;

function paint(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  palette: Palette,
  hop: boolean,
): void {
  const map: Record<string, number> = {
    h: palette.hair,
    s: palette.skin,
    t: palette.shirt,
    p: palette.pants,
    a: palette.accent,
    o: palette.outline,
  };
  const dy = hop ? -1 : 0;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const color = map[ch];
      if (color === undefined) continue;
      ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      ctx.fillRect(x * SCALE, (y + dy + 1) * SCALE, SCALE, SCALE);
    }
  }
}

function flipRows(rows: string[]): string[] {
  return rows.map((r) => [...r].reverse().join(""));
}

export function registerWorkerTextures(scene: Phaser.Scene): void {
  const dirs: Array<{ name: string; rows: string[] }> = [
    { name: "down", rows: FRONT },
    { name: "up", rows: BACK },
    { name: "right", rows: SIDE },
    { name: "left", rows: flipRows(SIDE) },
  ];

  for (const [id, palette] of Object.entries(PALETTES) as Array<[AgentId, Palette]>) {
    const sheetW = FW * SCALE * 8;
    const sheetH = FH * SCALE;
    const canvas = document.createElement("canvas");
    canvas.width = sheetW;
    canvas.height = sheetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.imageSmoothingEnabled = false;

    dirs.forEach((dir, di) => {
      for (let frame = 0; frame < 2; frame++) {
        ctx.save();
        ctx.translate((di * 2 + frame) * FW * SCALE, 0);
        paint(ctx, dir.rows, palette, frame === 1);
        ctx.restore();
      }
    });

    const key = `worker-${id}`;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addCanvas(key, canvas);
    const tex = scene.textures.get(key);
    let i = 0;
    for (const dir of dirs) {
      for (let frame = 0; frame < 2; frame++) {
        tex.add(`${dir.name}-${frame}`, 0, i * FW * SCALE, 0, FW * SCALE, FH * SCALE);
        i += 1;
      }
    }
  }
}

export const WORKER_FRAME = { w: FW * SCALE, h: FH * SCALE };
