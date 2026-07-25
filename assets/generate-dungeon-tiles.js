#!/usr/bin/env node
// Generates assets/dungeon-tiles.png and client/src/map/tilesetFrames.generated.ts
// from the Super Overhead Adventure 2 dungeon tileset (the same art pack every
// character, enemy and boss in this game came from).
//
// The tileset is still emitted by CODE — the renderer indexes a frame table that
// must match the PNG, and one script emitting both is what guarantees they can't
// drift (see the tileset note in CLAUDE.md). But the pixels are SAMPLED from the
// real art rather than drawn procedurally:
//
//   - We use ONE colour set from the sheet: the blue/cyan set (its far-left
//     block). The author's own example dungeon (Examples/Zaldo/Example
//     Dungeon.png) is built from this set, and it is the reference for how the
//     tiles are meant to compose.
//   - FLOORS : a single FLAT dark-blue floor tile, exactly as the example uses
//     it. The decorated block/water/panel tiles in this pack are 3D OBJECTS that
//     sit ON the floor (they cast shadows), not floor fill — tiling them was the
//     mistake in the previous pass. Every room type uses the same floor for now.
//   - WALLS  : the set's cyan brick, tiled, with autotile edge shading + rounded
//     corners composited on so the 47-tile blob is complete by construction.
//   - STAIRS, trap, boss passage, fire, slime, wall shadow and the door
//     portcullis stay procedurally drawn — small, animated, or absent from the set.
//
// The source sheet lives OUTSIDE the repo (like the SOA2 character import). The
// committed PNG + generated table are what the game loads; you only need the
// source to RE-RUN this. Override the path with SOA2_DUNGEON=... if yours differs.
//
// Run: npm run assets:tiles   (regenerates + syncs to the client)

const fs = require("path") && require("fs");
const path = require("path");
const { PNG } = require("../node_modules/pngjs");

const TILE = 32;
const SRC_TILE = 16; // native tile size in the source sheet
const SHEET_COLS = 12;

const SRC_PATH =
  process.env.SOA2_DUNGEON ||
  "/Users/snow/Downloads/Super Overhead Adventure 2/Environments/Dungeon.png";
const OUT_PNG = path.join(__dirname, "dungeon-tiles.png");
const OUT_TS = path.join(__dirname, "..", "client", "src", "map", "tilesetFrames.generated.ts");

if (!fs.existsSync(SRC_PATH)) {
  console.error(`Source sheet not found: ${SRC_PATH}\nSet SOA2_DUNGEON=/path/to/Dungeon.png`);
  process.exit(1);
}
const SRC = PNG.sync.read(fs.readFileSync(SRC_PATH));

/** Sample a source pixel (with alpha). Out-of-range reads as opaque black. */
function srcPx(x, y) {
  if (x < 0 || y < 0 || x >= SRC.width || y >= SRC.height) return [0, 0, 0, 255];
  const i = (y * SRC.width + x) * 4;
  return [SRC.data[i], SRC.data[i + 1], SRC.data[i + 2], SRC.data[i + 3]];
}

// ─── Source coordinates (16px tiles), from the BLUE set, verified by preview ───

/** The cyan brick every wall is built from. Tiles seamlessly. */
const WALL_BRICK = { x: 192, y: 0 };

/** The flat dark-blue floor, used exactly as the author's example dungeon does. */
const FLOOR_SRC = { x: 336, y: 192 };

// The renderer keys floors by room-type "theme". We only use the blue set right
// now, so every theme resolves to the same blue floor — but the keys stay so the
// exhaustive switch in TileRenderer still compiles and a second colour set can be
// slotted in per theme later without touching the renderer.
const THEME_NAMES = ["stone", "maze", "shop", "shrine", "chest", "boss"];

// ─── 32px drawing surface ──────────────────────────────────────────────────────

class Tile {
  constructor() {
    this.data = new Uint8Array(TILE * TILE * 4);
  }
  idx(x, y) {
    return (y * TILE + x) * 4;
  }
  px(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = this.idx(x, y);
    if (a >= 255) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return;
    }
    const t = a / 255;
    const bg = this.data[i + 3] / 255;
    const out = t + bg * (1 - t);
    if (out <= 0) return;
    for (let k = 0; k < 3; k++) {
      this.data[i + k] = Math.round((c[k] * t + this.data[i + k] * bg * (1 - t)) / out);
    }
    this.data[i + 3] = Math.round(out * 255);
  }
  clearPx(x, y) {
    this.data[this.idx(x, y) + 3] = 0;
  }
  rect(x, y, w, h, c, a = 255) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c, a);
  }
  fill(c) {
    this.rect(0, 0, TILE, TILE, c);
  }
  hline(y, x0, x1, c, a = 255) {
    for (let x = x0; x <= x1; x++) this.px(x, y, c, a);
  }
  vline(x, y0, y1, c, a = 255) {
    for (let y = y0; y <= y1; y++) this.px(x, y, c, a);
  }
  /** Blit a SRC_TILE-sized source tile scaled 2× to fill this 32px tile. */
  blitSource(sx, sy) {
    const scale = TILE / SRC_TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b] = srcPx(sx + Math.floor(x / scale), sy + Math.floor(y / scale));
        this.px(x, y, [r, g, b]);
      }
    }
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─── The 47-tile wall blob ───────────────────────────────────────────────────
//
// Neighbour bits, clockwise from north: 0 N 1 NE 2 E 3 SE 4 S 5 SW 6 W 7 NW.
// A diagonal only matters when both its adjacent cardinals are wall; clearing
// the rest collapses 256 arrangements onto the canonical 47.

const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;

function canonicalize(mask) {
  let m = mask;
  if (!(mask & N) || !(mask & E)) m &= ~NE;
  if (!(mask & E) || !(mask & S)) m &= ~SE;
  if (!(mask & S) || !(mask & W)) m &= ~SW;
  if (!(mask & W) || !(mask & N)) m &= ~NW;
  return m;
}

const CANONICAL = [];
{
  const seen = new Set();
  for (let m = 0; m < 256; m++) {
    const c = canonicalize(m);
    if (!seen.has(c)) {
      seen.add(c);
      CANONICAL.push(c);
    }
  }
  CANONICAL.sort((a, b) => a - b);
}

const OUTLINE = [0x06, 0x1c, 0x26];
const LIGHT = [0xc4, 0xff, 0xf4];
const SHADOW = [0x02, 0x18, 0x2c];

/** A wall frame: real brick, with directional shading + a rounded silhouette
 *  composited so exposed edges read as carved stone. The shading is alpha over
 *  the brick (not solid fills), so the hand-drawn texture stays visible. */
function drawWallTile(mask) {
  const t = new Tile();
  t.blitSource(WALL_BRICK.x, WALL_BRICK.y);
  const open = (bit) => !(mask & bit);

  // Light comes from the north-west: lift exposed N/W edges, sink exposed S/E.
  if (open(N)) {
    t.hline(1, 0, TILE - 1, LIGHT, 90);
    t.hline(2, 0, TILE - 1, LIGHT, 45);
  }
  if (open(W)) {
    t.vline(1, 0, TILE - 1, LIGHT, 70);
    t.vline(2, 0, TILE - 1, LIGHT, 32);
  }
  if (open(S)) {
    for (let i = 0; i < 5; i++) t.hline(TILE - 1 - i, 0, TILE - 1, SHADOW, 150 - i * 26);
  }
  if (open(E)) {
    for (let i = 0; i < 4; i++) t.vline(TILE - 1 - i, 0, TILE - 1, SHADOW, 130 - i * 28);
  }

  // 1px silhouette on every exposed side.
  if (open(N)) t.hline(0, 0, TILE - 1, OUTLINE);
  if (open(S)) t.hline(TILE - 1, 0, TILE - 1, OUTLINE);
  if (open(W)) t.vline(0, 0, TILE - 1, OUTLINE);
  if (open(E)) t.vline(TILE - 1, 0, TILE - 1, OUTLINE);

  // Outer corners: both cardinals open -> bite the corner off so the silhouette
  // reads as rounded stone rather than a hard square.
  const bite = (cx, cy, sx, sy) => {
    const clear = (x, y) => t.clearPx(x, y);
    clear(cx, cy);
    clear(cx + sx, cy);
    clear(cx, cy + sy);
    t.px(cx + sx * 2, cy, OUTLINE);
    t.px(cx + sx, cy + sy, OUTLINE);
    t.px(cx, cy + sy * 2, OUTLINE);
  };
  if (open(N) && open(W)) bite(0, 0, 1, 1);
  if (open(N) && open(E)) bite(TILE - 1, 0, -1, 1);
  if (open(S) && open(W)) bite(0, TILE - 1, 1, -1);
  if (open(S) && open(E)) bite(TILE - 1, TILE - 1, -1, -1);

  // Inner corners: the two cardinals are wall but the diagonal is not, so the
  // far room shows a small notch here.
  const notch = (cx, cy, sx, sy) => {
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4 - j; i++) {
        const x = cx + sx * i;
        const y = cy + sy * j;
        t.px(x, y, j === 0 || i === 0 ? OUTLINE : SHADOW, j === 0 || i === 0 ? 255 : 150);
      }
    }
  };
  if ((mask & N) && (mask & W) && open(NW)) notch(0, 0, 1, 1);
  if ((mask & N) && (mask & E) && open(NE)) notch(TILE - 1, 0, -1, 1);
  if ((mask & S) && (mask & W) && open(SW)) notch(0, TILE - 1, 1, -1);
  if ((mask & S) && (mask & E) && open(SE)) notch(TILE - 1, TILE - 1, -1, -1);

  return t;
}

// ─── Floor ───────────────────────────────────────────────────────────────────

/** The flat dark-blue floor. Deliberately plain — the example dungeon's floor is
 *  a solid fill, and the visual interest comes from the walls and from objects
 *  (blocks, enemies, pedestals) placed on top, not from floor texture. */
function drawFloor() {
  const t = new Tile();
  t.blitSource(FLOOR_SRC.x, FLOOR_SRC.y);
  return t;
}

// ─── Special tiles (procedural — small, animated, or absent from the pack) ─────

/** Stairs down. A drawn stairwell: a dark shaft with lit treads receding into
 *  it, so the tile reads as "descend" without a label — the first playtest's
 *  tester never registered the dungeon had floors when this was a flat square. */
function drawStairs() {
  const t = new Tile();
  const stone = [0x6b, 0x70, 0x80];
  const tread = [0x8e, 0x95, 0xa8];
  const riser = [0x3a, 0x3f, 0x4d];
  const shaft = [0x0b, 0x0c, 0x12];

  t.fill([0x4a, 0x4f, 0x5e]);
  t.rect(1, 1, 30, 30, riser);
  t.rect(2, 2, 28, 28, shaft);
  const steps = [
    { y: 23, inset: 2 },
    { y: 18, inset: 4 },
    { y: 13, inset: 6 },
    { y: 8, inset: 8 },
  ];
  for (const { y, inset } of steps) {
    const w = TILE - inset * 2;
    t.rect(inset, y, w, 4, stone);
    t.hline(y, inset, inset + w - 1, tread);
    t.hline(y + 4, inset, inset + w - 1, [0x1c, 0x1f, 0x28]);
  }
  t.rect(0, 28, 32, 4, [0x5a, 0x60, 0x71]);
  t.hline(28, 0, 31, tread);
  t.vline(0, 0, 31, [0x2c, 0x30, 0x3c]);
  t.vline(31, 0, 31, [0x2c, 0x30, 0x3c]);
  t.hline(0, 0, 31, [0x1c, 0x1f, 0x28]);
  t.hline(31, 0, 31, [0x1c, 0x1f, 0x28]);
  return t;
}

/** Warp trap. Loud on purpose — stepping on one is a mistake, not a coin flip. */
function drawTrap() {
  const t = new Tile();
  const plate = [0x3c, 0x2e, 0x50];
  const rim = [0x6a, 0x51, 0x8c];
  const core = [0x1a, 0x12, 0x28];
  t.fill(plate);
  t.rect(1, 1, 30, 30, [0x2f, 0x24, 0x40]);
  t.hline(1, 1, 30, rim);
  t.hline(30, 1, 30, [0x24, 0x1b, 0x33]);
  t.vline(1, 1, 30, rim);
  t.vline(30, 1, 30, [0x24, 0x1b, 0x33]);
  const cx = 15.5, cy = 15.5;
  for (let ring = 0; ring < 4; ring++) {
    const rad = 4 + ring * 3;
    for (let a = 0; a < 360; a += 4) {
      const rel = ((a / 180) * Math.PI) - ring * 1.3;
      if (Math.cos(rel) > 0.72) continue;
      const x = Math.round(cx + Math.cos((a / 180) * Math.PI) * rad);
      const y = Math.round(cy + Math.sin((a / 180) * Math.PI) * rad);
      t.px(x, y, ring < 2 ? [0xd8, 0xb4, 0xff] : [0x8f, 0x6c, 0xc4]);
    }
  }
  t.rect(14, 14, 4, 4, core);
  t.rect(15, 15, 2, 2, [0xe6, 0xd2, 0xff]);
  return t;
}

/** The gold passage into a boss room — the blue floor with gold veins on top. */
function drawBossFloor() {
  const t = new Tile();
  t.blitSource(FLOOR_SRC.x, FLOOR_SRC.y);
  const gold = [0xc9, 0x9d, 0x45];
  const goldLit = [0xf0, 0xd0, 0x7a];
  for (let i = 0; i < TILE; i++) {
    t.px(i, i, gold);
    t.px(i, TILE - 1 - i, gold);
    if (i % 4 === 0) {
      t.px(i, i + 1, goldLit);
      t.px(i, TILE - 2 - i, goldLit);
    }
  }
  t.rect(13, 13, 6, 6, gold);
  t.rect(14, 14, 4, 4, goldLit);
  t.rect(15, 15, 2, 2, [0xff, 0xf2, 0xc0]);
  return t;
}

function drawFire() {
  const t = new Tile();
  const r = rng(0xf13e);
  t.fill([0x3a, 0x21, 0x18]);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const v = r();
      if (v < 0.1) t.px(x, y, [0xff, 0x8c, 0x2a]);
      else if (v < 0.2) t.px(x, y, [0xc4, 0x4d, 0x18]);
      else if (v < 0.28) t.px(x, y, [0x6a, 0x2a, 0x14]);
    }
  t.rect(11, 11, 10, 10, [0xff, 0xc4, 0x50]);
  t.rect(13, 13, 6, 6, [0xff, 0xef, 0xb0]);
  return t;
}

function drawSlime() {
  const t = new Tile();
  const r = rng(0x51e);
  t.fill([0x2f, 0x5a, 0x33]);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const v = r();
      if (v < 0.1) t.px(x, y, [0x54, 0x8f, 0x4c]);
      else if (v < 0.18) t.px(x, y, [0x24, 0x46, 0x28]);
    }
  for (const [x, y, s] of [[7, 9, 3], [20, 7, 2], [14, 20, 4], [24, 22, 2]]) {
    t.rect(x, y, s, s, [0x7d, 0xc0, 0x6a]);
    t.rect(x, y, s - 1, 1, [0xa8, 0xe0, 0x92]);
  }
  return t;
}

/** Cast down onto whatever floor tile sits directly south of a wall. */
function drawWallShadow() {
  const t = new Tile();
  const rows = [200, 150, 105, 70, 44, 24, 10];
  for (let i = 0; i < rows.length; i++) t.rect(0, i, TILE, 1, [0x08, 0x09, 0x11], rows[i]);
  return t;
}

/** The portcullis over a locked doorway — iron bars say "locked" without the old
 *  red debug rectangle. */
function drawBarrier() {
  const t = new Tile();
  const iron = [0x6a, 0x6f, 0x7e];
  const ironLit = [0x8f, 0x96, 0xa8];
  const ironDark = [0x33, 0x37, 0x44];
  const gap = [0x14, 0x16, 0x1f];
  t.fill(gap);
  for (let x = 2; x < TILE; x += 8) {
    t.rect(x, 0, 4, TILE, iron);
    t.vline(x, 0, TILE - 1, ironLit);
    t.vline(x + 3, 0, TILE - 1, ironDark);
  }
  for (const y of [6, 22]) {
    t.rect(0, y, TILE, 4, iron);
    t.hline(y, 0, TILE - 1, ironLit);
    t.hline(y + 3, 0, TILE - 1, ironDark);
    for (let x = 3; x < TILE; x += 8) t.rect(x, y + 1, 2, 2, ironLit);
  }
  return t;
}

// ─── Compose the sheet ───────────────────────────────────────────────────────

const frames = [];
const push = (tile) => frames.push(tile) - 1;

const wallFrameByCanonical = new Map();
for (const mask of CANONICAL) wallFrameByCanonical.set(mask, push(drawWallTile(mask)));

// One flat blue floor, shared by every theme (we use a single colour set for now).
const floorFrame = push(drawFloor());
const floorFrames = {};
for (const theme of THEME_NAMES) floorFrames[theme] = [floorFrame];

const special = {
  stairs: push(drawStairs()),
  trap: push(drawTrap()),
  bossFloor: push(drawBossFloor()),
  fire: push(drawFire()),
  slime: push(drawSlime()),
  wallShadow: push(drawWallShadow()),
  barrier: push(drawBarrier()),
};

const rows = Math.ceil(frames.length / SHEET_COLS);
const png = new PNG({ width: SHEET_COLS * TILE, height: rows * TILE });
png.data.fill(0);
frames.forEach((tile, idx) => {
  const ox = (idx % SHEET_COLS) * TILE;
  const oy = Math.floor(idx / SHEET_COLS) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const src = (y * TILE + x) * 4;
      const dst = ((oy + y) * png.width + ox + x) * 4;
      png.data[dst] = tile.data[src];
      png.data[dst + 1] = tile.data[src + 1];
      png.data[dst + 2] = tile.data[src + 2];
      png.data[dst + 3] = tile.data[src + 3];
    }
  }
});
fs.writeFileSync(OUT_PNG, PNG.sync.write(png));

// ─── Emit the frame table ────────────────────────────────────────────────────

const maskToFrame = new Array(256);
for (let m = 0; m < 256; m++) maskToFrame[m] = wallFrameByCanonical.get(canonicalize(m));

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const ts = `// GENERATED by assets/generate-dungeon-tiles.js — do not edit.
// Frame indices into dungeon-tiles.png (walls + floors sampled from the Super
// Overhead Adventure 2 dungeon sheet). Regenerate with:
//   npm run assets:tiles

/** Every floor look the dungeon has. Room types map onto these in TileRenderer. */
export type FloorTheme = ${THEME_NAMES.map((t) => `"${t}"`).join(" | ")};

export const FLOOR_VARIANT_FRAMES: Record<FloorTheme, readonly number[]> = {
${THEME_NAMES.map((t) => `  ${t}: [${floorFrames[t].join(", ")}],`).join("\n")}
};

/** Wall frame for an 8-neighbour mask (bit 0 = N, then clockwise: NE E SE S SW W NW).
 *  A set bit means "that neighbour is also wall". Indexed by the raw 0–255 mask;
 *  the 256 -> 47 reduction is already folded in. */
export const WALL_FRAME_BY_MASK: readonly number[] = [
${chunk(maskToFrame, 16).map((row) => `  ${row.join(", ")},`).join("\n")}
];

export const SPECIAL_FRAMES = {
${Object.entries(special).map(([k, v]) => `  ${k}: ${v},`).join("\n")}
} as const;
`;
fs.writeFileSync(OUT_TS, ts);

// ─── Preview: an assembled room per theme ────────────────────────────────────

if (process.env.TILE_PREVIEW) {
  const TW = 7, TH = 5, pad = 8;
  const prev = new PNG({ width: THEME_NAMES.length * (TW * TILE + pad) + pad, height: TH * TILE + pad * 2 });
  prev.data.fill(20);
  const frameAt = (idx) => frames[idx];
  const wallMaskFor = (rx, ry) => {
    // neighbours are wall if on the border ring
    const wallAt = (x, y) => x < 0 || y < 0 || x >= TW || y >= TH || x === 0 || y === 0 || x === TW - 1 || y === TH - 1;
    let m = 0;
    if (wallAt(rx, ry - 1)) m |= N;
    if (wallAt(rx + 1, ry - 1)) m |= NE;
    if (wallAt(rx + 1, ry)) m |= E;
    if (wallAt(rx + 1, ry + 1)) m |= SE;
    if (wallAt(rx, ry + 1)) m |= S;
    if (wallAt(rx - 1, ry + 1)) m |= SW;
    if (wallAt(rx - 1, ry)) m |= W;
    if (wallAt(rx - 1, ry - 1)) m |= NW;
    return m;
  };
  THEME_NAMES.forEach((theme, ti) => {
    const ox = pad + ti * (TW * TILE + pad), oy = pad;
    for (let ry = 0; ry < TH; ry++) {
      for (let rx = 0; rx < TW; rx++) {
        const border = rx === 0 || ry === 0 || rx === TW - 1 || ry === TH - 1;
        const idx = border
          ? maskToFrame[wallMaskFor(rx, ry)]
          : floorFrames[theme][0];
        const tile = frameAt(idx);
        for (let y = 0; y < TILE; y++)
          for (let x = 0; x < TILE; x++) {
            const s = (y * TILE + x) * 4;
            if (tile.data[s + 3] === 0) continue;
            const d = ((oy + ry * TILE + y) * prev.width + ox + rx * TILE + x) * 4;
            prev.data[d] = tile.data[s];
            prev.data[d + 1] = tile.data[s + 1];
            prev.data[d + 2] = tile.data[s + 2];
            prev.data[d + 3] = 255;
          }
      }
    }
  });
  fs.writeFileSync(process.env.TILE_PREVIEW, PNG.sync.write(prev));
  console.log(`preview -> ${process.env.TILE_PREVIEW}`);
}

console.log(
  `dungeon-tiles.png: ${frames.length} frames (${CANONICAL.length} wall, ` +
  `1 floor, ${Object.keys(special).length} special) at ${png.width}x${png.height}`,
);
console.log(`tilesetFrames.generated.ts written`);
