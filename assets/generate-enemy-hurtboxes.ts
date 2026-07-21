#!/usr/bin/env npx ts-node
// Derives every enemy's HURT BOUNDS from its spritesheet.
//
// Companion to generate-fx-hurtboxes.js, which does the same for weapon swings.
// Together they mean neither half of a melee exchange has a hand-tuned number:
// the attack's reach comes from the attack art, and what it can land on comes
// from the creature art.
//
// Run via: npx ts-node assets/generate-enemy-hurtboxes.ts
// Re-run after adding an enemy or replacing a sheet. The OUTPUT is checked in —
// the authoritative server must never decode a PNG at runtime.
//
// This is TypeScript rather than plain JS because it imports the geometry table
// (client/src/enemies/spriteGeometry.ts) that the client renders from, so the
// bounds measured here are necessarily measured against the layout actually
// drawn. That table is deliberately Phaser-free: importing the visual defs
// instead would throw `window is not defined` the moment Phaser loaded.

import * as fs from "fs";
import * as path from "path";
import { PNG } from "pngjs";
import { EnemyType, CharacterType } from "shared";
import { ENEMY_SPRITE_GEOMETRY, SpriteGeometry } from "../client/src/enemies/spriteGeometry";

const ASSETS = __dirname;
const OUT = path.join(__dirname, "..", "shared", "src", "enemies", "hurtBounds.generated.ts");

// Alpha at or below this counts as transparent, so a stray near-zero-alpha pixel
// at the edge of the art can't inflate a creature's hurt box.
const ALPHA_THRESHOLD = 16;

interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** Opaque bounds of one frame within its cell, in source px, or null if empty. */
function frameBounds(png: PNG, geo: SpriteGeometry, frame: number): Bounds | null {
  const perRow = Math.floor(png.width / geo.frameWidth);
  const col = frame % perRow;
  const row = Math.floor(frame / perRow);
  const ox = col * geo.frameWidth;
  const oy = row * geo.frameHeight;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < geo.frameHeight; y++) {
    for (let x = 0; x < geo.frameWidth; x++) {
      const px = ox + x;
      const py = oy + y;
      if (px >= png.width || py >= png.height) continue;
      const idx = (py * png.width + px) * 4;
      if (png.data[idx + 3] <= ALPHA_THRESHOLD) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// The 12 humanoid skins all share the 15×4 @32 sheet layout (HumanoidSprites),
// rendered at one tile. They're measured as a UNION across every skin: a player's
// damageable region must not depend on which costume they picked.
const HUMANOID_CELL = 32;
const HUMANOID_DISPLAY = 32;
const CHARACTER_TYPES: CharacterType[] = [
  "guy", "guy-blue", "gal", "gal-green",
  "skeleton", "skeleton-mage", "colt", "the-fool",
  "gigante", "reptile", "kobold", "scaleless",
];

const rows: string[] = [];
const report: string[] = [];

for (const [id, geo] of Object.entries(ENEMY_SPRITE_GEOMETRY) as [EnemyType, SpriteGeometry][]) {
  const file = path.join(ASSETS, `${geo.textureKey}.png`);
  if (!fs.existsSync(file)) throw new Error(`${id}: missing spritesheet ${file}`);
  const png = PNG.sync.read(fs.readFileSync(file));

  // Union across the enemy's OWN frames. A hurtbox must be stable — if it tracked
  // the current frame, a creature could dodge by animating, and the server would
  // need the client's animation clock to agree on hit tests.
  let u: Bounds | null = null;
  for (const f of geo.frames) {
    const b = frameBounds(png, geo, f);
    if (!b) continue;
    u = u === null ? b : {
      x0: Math.min(u.x0, b.x0),
      y0: Math.min(u.y0, b.y0),
      x1: Math.max(u.x1, b.x1),
      y1: Math.max(u.y1, b.y1),
    };
  }
  if (!u) throw new Error(`${id}: every frame of ${geo.textureKey}.png is empty`);

  // Source px → on-screen px.
  const sx = geo.displayW / geo.frameWidth;
  const sy = geo.displayH / geo.frameHeight;

  // The sprite is centred on the entity's state.x/y, so bounds are expressed
  // relative to the CELL centre — art that doesn't sit centred in its cell (most
  // of it: creatures are usually drawn standing on the bottom edge) gets a real
  // offset rather than a box that silently drifts off the drawing.
  const halfW = ((u.x1 - u.x0 + 1) / 2) * sx;
  const halfH = ((u.y1 - u.y0 + 1) / 2) * sy;
  const offsetX = ((u.x0 + u.x1 + 1) / 2 - geo.frameWidth / 2) * sx;
  const offsetY = ((u.y0 + u.y1 + 1) / 2 - geo.frameHeight / 2) * sy;

  const r = (n: number) => Math.round(n * 100) / 100;
  rows.push(`  "${id}": { halfW: ${r(halfW)}, halfH: ${r(halfH)}, offsetX: ${r(offsetX)}, offsetY: ${r(offsetY)} },`);
  report.push(`  ${id.padEnd(22)} ${r(halfW * 2)}×${r(halfH * 2)}px  offset(${r(offsetX)}, ${r(offsetY)})`);
}

// ── Players ───────────────────────────────────────────────────────────────────
let pu: Bounds | null = null;
for (const skin of CHARACTER_TYPES) {
  const file = path.join(ASSETS, `${skin}.png`);
  if (!fs.existsSync(file)) throw new Error(`character skin: missing ${file}`);
  const png = PNG.sync.read(fs.readFileSync(file));
  const geo: SpriteGeometry = {
    textureKey: skin,
    frameWidth: HUMANOID_CELL,
    frameHeight: HUMANOID_CELL,
    cols: Math.floor(png.width / HUMANOID_CELL),
    frames: [],
    displayW: HUMANOID_DISPLAY,
    displayH: HUMANOID_DISPLAY,
  };
  const total = geo.cols * Math.floor(png.height / HUMANOID_CELL);
  for (let f = 0; f < total; f++) {
    const b = frameBounds(png, geo, f);
    if (!b) continue;
    pu = pu === null ? b : {
      x0: Math.min(pu.x0, b.x0),
      y0: Math.min(pu.y0, b.y0),
      x1: Math.max(pu.x1, b.x1),
      y1: Math.max(pu.y1, b.y1),
    };
  }
}
if (!pu) throw new Error("no opaque pixels in any character skin");
const ps = HUMANOID_DISPLAY / HUMANOID_CELL;
const rr = (n: number) => Math.round(n * 100) / 100;
const playerBounds = {
  halfW: rr(((pu.x1 - pu.x0 + 1) / 2) * ps),
  halfH: rr(((pu.y1 - pu.y0 + 1) / 2) * ps),
  offsetX: rr(((pu.x0 + pu.x1 + 1) / 2 - HUMANOID_CELL / 2) * ps),
  offsetY: rr(((pu.y0 + pu.y1 + 1) / 2 - HUMANOID_CELL / 2) * ps),
};

const out = `// GENERATED FILE — do not edit by hand.
// Produced by assets/generate-enemy-hurtboxes.ts from the enemy spritesheets.
// Re-run that script after adding an enemy or replacing a sheet.

import { EnemyType } from "./base";

/** An entity's damageable region: a box centred on its sprite, in world px.
 *  Half-extents plus an offset from the sprite centre (state.x/y), because most
 *  creature art doesn't sit centred in its cell. */
export interface HurtBounds {
  halfW: number;
  halfH: number;
  offsetX: number;
  offsetY: number;
}

/** Measured from the union of each enemy's own animation frames — stable, so a
 *  creature can't dodge by animating. */
export const ENEMY_HURT_BOUNDS: Record<EnemyType, HurtBounds> = {
${rows.join("\n")}
};

/** The player's damageable region: the union across all 12 humanoid skins, so a
 *  costume choice can never change how easy someone is to hit. */
export const PLAYER_HURT_BOUNDS: HurtBounds = { halfW: ${playerBounds.halfW}, halfH: ${playerBounds.halfH}, offsetX: ${playerBounds.offsetX}, offsetY: ${playerBounds.offsetY} };
`;

fs.writeFileSync(OUT, out);
console.log(`Wrote ${path.relative(path.join(__dirname, ".."), OUT)}`);
console.log(report.join("\n"));
console.log(`  ${"PLAYER (all skins)".padEnd(22)} ${playerBounds.halfW * 2}×${playerBounds.halfH * 2}px  offset(${playerBounds.offsetX}, ${playerBounds.offsetY})`);
