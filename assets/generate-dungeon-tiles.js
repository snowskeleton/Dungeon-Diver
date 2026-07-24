#!/usr/bin/env node
// Generates assets/dungeon-tiles.png and client/src/map/tilesetFrames.generated.ts.
//
// The tileset is CODE, not a hand-painted PNG. Every frame here is drawn
// pixel-by-pixel from the palettes below, which buys three things a painted
// sheet would not:
//
//   1. The 47-tile wall blob is *complete* by construction. Autotiling needs a
//      frame for every meaningful arrangement of a tile's eight neighbours;
//      hand-authoring 47 mutually consistent frames is where tilesets rot.
//      Here the canonical mask set is enumerated and each frame is drawn from
//      its own mask, so a wall can never fall back to a wrong edge.
//   2. The mask -> frame table ships with the art. The generator emits both,
//      so TileRenderer cannot index a sheet that has moved under it.
//   3. Re-theming is a palette edit, not a repaint.
//
// Run: node assets/generate-dungeon-tiles.js   (then npm run assets:build)

const fs = require("fs");
const path = require("path");
const { PNG } = require("../node_modules/pngjs");

const TILE = 32;
const SHEET_COLS = 12;

const OUT_PNG = path.join(__dirname, "dungeon-tiles.png");
const OUT_TS = path.join(__dirname, "..", "client", "src", "map", "tilesetFrames.generated.ts");

// ─── Palettes ────────────────────────────────────────────────────────────────

const WALL = {
  outline: [0x12, 0x14, 0x1d],
  body:    [0x3b, 0x41, 0x57],
  seam:    [0x2c, 0x31, 0x43],
  speck:   [0x46, 0x4d, 0x66],
  top:     [0x5c, 0x65, 0x83],
  lit:     [0x7e, 0x89, 0xac],
  dark:    [0x23, 0x27, 0x35],
};

// One entry per FLOOR THEME. Room types collapse onto these in TileRenderer's
// exhaustive switch — combat/wave/timed/dark all read as plain dungeon stone
// because they ARE plain dungeon stone; only the rooms that mean something
// different look different.
const FLOOR_THEMES = {
  stone: {
    base:   [0x55, 0x5b, 0x6c],
    seam:   [0x3f, 0x44, 0x53],
    light:  [0x63, 0x6a, 0x7c],
    dark:   [0x48, 0x4d, 0x5d],
    accent: [0x71, 0x78, 0x8c],
  },
  // Warm dusty cobble. Deliberately far from `chest`'s moss green — the two
  // were both greens and neighbouring rooms of the two types read as one room.
  maze: {
    base:   [0x63, 0x5a, 0x4c],
    seam:   [0x4a, 0x42, 0x37],
    light:  [0x74, 0x6a, 0x59],
    dark:   [0x55, 0x4d, 0x41],
    accent: [0x8a, 0x7c, 0x63],
  },
  shop: {
    base:   [0x6d, 0x4c, 0x30],
    seam:   [0x51, 0x37, 0x21],
    light:  [0x7e, 0x5a, 0x3a],
    dark:   [0x5d, 0x40, 0x28],
    accent: [0x92, 0x6c, 0x45],
  },
  shrine: {
    base:   [0x6f, 0x7b, 0x92],
    seam:   [0x55, 0x60, 0x74],
    light:  [0x84, 0x92, 0xad],
    dark:   [0x60, 0x6b, 0x81],
    accent: [0x9e, 0xad, 0xc8],
  },
  chest: {
    base:   [0x47, 0x60, 0x4b],
    seam:   [0x33, 0x48, 0x37],
    light:  [0x54, 0x70, 0x58],
    dark:   [0x3d, 0x54, 0x41],
    accent: [0x6a, 0x8a, 0x5c],
  },
  boss: {
    base:   [0x5b, 0x3c, 0x42],
    seam:   [0x43, 0x2a, 0x30],
    light:  [0x6c, 0x49, 0x4f],
    dark:   [0x4d, 0x32, 0x38],
    accent: [0xa8, 0x84, 0x3c],
  },
};

const FLOOR_VARIANTS = 8;

// ─── Tiny drawing surface ────────────────────────────────────────────────────

class Tile {
  constructor() {
    this.data = new Uint8Array(TILE * TILE * 4);
  }
  px(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    if (a >= 255) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return;
    }
    // Source-over onto whatever is already there.
    const t = a / 255;
    const bg = this.data[i + 3] / 255;
    const out = t + bg * (1 - t);
    if (out <= 0) return;
    for (let k = 0; k < 3; k++) {
      this.data[i + k] = Math.round((c[k] * t + this.data[i + k] * bg * (1 - t)) / out);
    }
    this.data[i + 3] = Math.round(out * 255);
  }
  rect(x, y, w, h, c, a = 255) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) this.px(i, j, c, a);
    }
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
}

/** Deterministic per-frame noise. Frames must be byte-identical run to run or
 *  the checked-in PNG churns on every regeneration. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─── The 47-tile wall blob ───────────────────────────────────────────────────
//
// Neighbour bits, clockwise from north:
//   0 N   1 NE   2 E   3 SE   4 S   5 SW   6 W   7 NW
//
// A diagonal only changes how a tile is drawn when BOTH of its adjacent
// cardinals are also wall — otherwise the corner is already an outer corner and
// the diagonal is invisible. Clearing the irrelevant diagonals collapses 256
// arrangements onto the canonical 47.

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

/** Stone-block body: horizontal courses with staggered vertical joints. */
function wallBody(t, seed) {
  const r = rng(seed);
  t.fill(WALL.body);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = r();
      if (v < 0.06) t.px(x, y, WALL.speck);
      else if (v < 0.11) t.px(x, y, WALL.seam);
    }
  }
  for (let cy = 0; cy < TILE; cy += 8) {
    t.hline(cy, 0, TILE - 1, WALL.seam);
    const off = (cy / 8) % 2 === 0 ? 0 : 8;
    for (let x = off; x < TILE; x += 16) t.vline(x, cy, Math.min(cy + 7, TILE - 1), WALL.seam);
  }
}

function drawWallTile(mask) {
  const t = new Tile();
  wallBody(t, 0x9e37 + mask * 2654435761);

  const open = (bit) => !(mask & bit);

  // Lit cap where the wall's north face is exposed, shadow where its south is.
  if (open(N)) {
    t.rect(0, 1, TILE, 4, WALL.top);
    t.hline(1, 0, TILE - 1, WALL.lit);
  }
  if (open(S)) {
    t.rect(0, TILE - 5, TILE, 4, WALL.dark);
    t.hline(TILE - 5, 0, TILE - 1, WALL.seam);
  }
  if (open(W)) {
    t.rect(1, 0, 3, TILE, WALL.dark);
    t.vline(1, 0, TILE - 1, WALL.seam);
  }
  if (open(E)) {
    t.rect(TILE - 4, 0, 3, TILE, WALL.dark);
    t.vline(TILE - 2, 0, TILE - 1, WALL.seam);
  }

  // 1px silhouette on every exposed side.
  if (open(N)) t.hline(0, 0, TILE - 1, WALL.outline);
  if (open(S)) t.hline(TILE - 1, 0, TILE - 1, WALL.outline);
  if (open(W)) t.vline(0, 0, TILE - 1, WALL.outline);
  if (open(E)) t.vline(TILE - 1, 0, TILE - 1, WALL.outline);

  // Outer corners: both cardinals open -> bite the corner off so the silhouette
  // reads as rounded stone rather than a hard square.
  const bite = (cx, cy, sx, sy) => {
    const clear = (x, y) => { t.data[((y * TILE + x) * 4) + 3] = 0; };
    clear(cx, cy);
    clear(cx + sx, cy);
    clear(cx, cy + sy);
    t.px(cx + sx * 2, cy, WALL.outline);
    t.px(cx + sx, cy + sy, WALL.outline);
    t.px(cx, cy + sy * 2, WALL.outline);
  };
  if (open(N) && open(W)) bite(0, 0, 1, 1);
  if (open(N) && open(E)) bite(TILE - 1, 0, -1, 1);
  if (open(S) && open(W)) bite(0, TILE - 1, 1, -1);
  if (open(S) && open(E)) bite(TILE - 1, TILE - 1, -1, -1);

  // Inner corners: the two cardinals are wall but the diagonal is not, so a
  // notch of the far room shows through here.
  const notch = (cx, cy, sx, sy) => {
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4 - j; i++) {
        const x = cx + sx * i;
        const y = cy + sy * j;
        t.px(x, y, j === 0 || i === 0 ? WALL.outline : WALL.dark);
      }
    }
  };
  if ((mask & N) && (mask & W) && open(NW)) notch(0, 0, 1, 1);
  if ((mask & N) && (mask & E) && open(NE)) notch(TILE - 1, 0, -1, 1);
  if ((mask & S) && (mask & W) && open(SW)) notch(0, TILE - 1, 1, -1);
  if ((mask & S) && (mask & E) && open(SE)) notch(TILE - 1, TILE - 1, -1, -1);

  return t;
}

// ─── Floors ──────────────────────────────────────────────────────────────────

/** Flagstone: 16px stones, courses offset every other row, seams on the tile
 *  edges so neighbouring tiles join up. */
function drawFloorTile(theme, variant) {
  const p = FLOOR_THEMES[theme];
  const t = new Tile();
  const r = rng(0x51ab + variant * 7919 + hashString(theme));

  t.fill(p.base);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = r();
      if (v < 0.07) t.px(x, y, p.light);
      else if (v < 0.14) t.px(x, y, p.dark);
    }
  }

  for (let y = 0; y < TILE; y += 16) {
    t.hline(y, 0, TILE - 1, p.seam);
    t.hline(y + 1, 0, TILE - 1, p.light, 60);
    const off = (y / 16) % 2 === 0 ? 0 : 8;
    for (let x = off; x < TILE + off; x += 16) {
      t.vline(x % TILE, y, y + 15, p.seam);
    }
  }

  // Variant 0 is the plain stone the renderer lays down most of the time; the
  // rest are the ones that break up the grid.
  if (variant === 1) {
    crack(t, r, p, 6, 9);
  } else if (variant === 2) {
    crack(t, r, p, 20, 3);
  } else if (variant === 3) {
    for (let i = 0; i < 5; i++) pebble(t, r, p);
  } else if (variant === 4) {
    t.rect(9, 20, 5, 4, p.dark);
    t.rect(10, 21, 3, 2, p.seam);
    pebble(t, r, p);
  } else if (variant === 5) {
    crack(t, r, p, 24, 22);
    pebble(t, r, p);
  } else if (variant === 6) {
    for (let i = 0; i < 3; i++) {
      const x = 4 + Math.floor(r() * 24);
      const y = 4 + Math.floor(r() * 24);
      t.rect(x, y, 2, 2, p.accent);
    }
  } else if (variant === 7) {
    t.rect(6, 6, 6, 5, p.dark);
    t.hline(6, 6, 11, p.seam);
    crack(t, r, p, 18, 14);
  }

  return t;
}

/** A hairline fracture. Deliberately one pixel wide and monotonic in x: an
 *  earlier version walked y freely and doubled the line, which at 2x zoom read
 *  as a little check-mark stamped on the floor rather than as stone. */
function crack(t, r, p, x0, y0) {
  let x = x0;
  let y = y0;
  const len = 6 + Math.floor(r() * 7);
  const drift = r() < 0.5 ? 1 : -1;
  for (let i = 0; i < len; i++) {
    t.px(x, y, p.seam);
    x += 1;
    if (r() < 0.3) y += drift;
    if (x >= TILE - 1 || y <= 1 || y >= TILE - 2) break;
  }
}

function pebble(t, r, p) {
  const x = 3 + Math.floor(r() * 25);
  const y = 3 + Math.floor(r() * 25);
  t.px(x, y, p.accent);
  t.px(x + 1, y, p.accent);
  t.px(x, y + 1, p.dark);
  t.px(x + 1, y + 1, p.dark);
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Special tiles ───────────────────────────────────────────────────────────

/** Stairs down. The first playtest's tester never registered that the dungeon
 *  had multiple floors, because this was a flat yellow square. It is now a
 *  stairwell: a black shaft at the top with lit treads marching down out of it,
 *  so the tile reads as "descend" without a label. */
function drawStairs() {
  const t = new Tile();
  const stone = [0x6b, 0x70, 0x80];
  const tread = [0x8e, 0x95, 0xa8];
  const riser = [0x3a, 0x3f, 0x4d];
  const shaft = [0x0b, 0x0c, 0x12];

  t.fill([0x4a, 0x4f, 0x5e]);
  t.rect(1, 1, 30, 30, riser);
  t.rect(2, 2, 28, 28, shaft);

  // Four treads, narrowing as they recede into the shaft.
  const steps = [
    { y: 23, inset: 2 },
    { y: 18, inset: 4 },
    { y: 13, inset: 6 },
    { y: 8,  inset: 8 },
  ];
  for (const { y, inset } of steps) {
    const w = TILE - inset * 2;
    t.rect(inset, y, w, 4, stone);
    t.hline(y, inset, inset + w - 1, tread);
    t.hline(y + 4, inset, inset + w - 1, [0x1c, 0x1f, 0x28]);
  }

  // Frame the mouth so the shaft doesn't bleed into the surrounding floor.
  t.rect(0, 28, 32, 4, [0x5a, 0x60, 0x71]);
  t.hline(28, 0, 31, tread);
  t.vline(0, 0, 31, [0x2c, 0x30, 0x3c]);
  t.vline(31, 0, 31, [0x2c, 0x30, 0x3c]);
  t.hline(0, 0, 31, [0x1c, 0x1f, 0x28]);
  t.hline(31, 0, 31, [0x1c, 0x1f, 0x28]);
  return t;
}

/** Warp trap. Rendered in plain sight on purpose — stepping on one is a
 *  mistake, not a coin flip — so it is the loudest thing on the floor. */
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

  // A spiral, drawn as concentric rings with a rotating gap — reads as a vortex
  // at 2x zoom without needing an animation.
  const cx = 15.5;
  const cy = 15.5;
  for (let ring = 0; ring < 4; ring++) {
    const rad = 4 + ring * 3;
    const gap = ring * 1.3;
    for (let a = 0; a < 360; a += 4) {
      const rel = ((a / 180) * Math.PI) - gap;
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

/** The gold passage into a boss room. */
function drawBossFloor() {
  const t = new Tile();
  const p = FLOOR_THEMES.boss;
  const gold = [0xc9, 0x9d, 0x45];
  const goldLit = [0xf0, 0xd0, 0x7a];
  const r = rng(0xb055);

  t.fill(p.base);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = r();
      if (v < 0.06) t.px(x, y, p.light);
      else if (v < 0.12) t.px(x, y, p.dark);
    }
  }
  t.hline(0, 0, TILE - 1, p.seam);
  t.vline(0, 0, TILE - 1, p.seam);

  // Veins running corner to corner, so a run of these tiles chains into a path.
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
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = r();
      if (v < 0.10) t.px(x, y, [0xff, 0x8c, 0x2a]);
      else if (v < 0.20) t.px(x, y, [0xc4, 0x4d, 0x18]);
      else if (v < 0.28) t.px(x, y, [0x6a, 0x2a, 0x14]);
    }
  }
  t.rect(11, 11, 10, 10, [0xff, 0xc4, 0x50]);
  t.rect(13, 13, 6, 6, [0xff, 0xef, 0xb0]);
  return t;
}

function drawSlime() {
  const t = new Tile();
  const r = rng(0x51e);
  t.fill([0x2f, 0x5a, 0x33]);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = r();
      if (v < 0.10) t.px(x, y, [0x54, 0x8f, 0x4c]);
      else if (v < 0.18) t.px(x, y, [0x24, 0x46, 0x28]);
    }
  }
  for (const [x, y, s] of [[7, 9, 3], [20, 7, 2], [14, 20, 4], [24, 22, 2]]) {
    t.rect(x, y, s, s, [0x7d, 0xc0, 0x6a]);
    t.rect(x, y, s - 1, 1, [0xa8, 0xe0, 0x92]);
  }
  return t;
}

/** The portcullis over a locked doorway. Was a flat red square with a brighter
 *  red border — the one piece of the map that still announced itself as a
 *  debug rectangle. Iron bars say "locked" without needing to be red. */
function drawBarrier() {
  const t = new Tile();
  const iron = [0x6a, 0x6f, 0x7e];
  const ironLit = [0x8f, 0x96, 0xa8];
  const ironDark = [0x33, 0x37, 0x44];
  const gap = [0x14, 0x16, 0x1f];

  t.fill(gap);
  // Verticals every 8px, so a run of these reads as one continuous grille.
  for (let x = 2; x < TILE; x += 8) {
    t.rect(x, 0, 4, TILE, iron);
    t.vline(x, 0, TILE - 1, ironLit);
    t.vline(x + 3, 0, TILE - 1, ironDark);
  }
  // Two horizontal bands with rivets.
  for (const y of [6, 22]) {
    t.rect(0, y, TILE, 4, iron);
    t.hline(y, 0, TILE - 1, ironLit);
    t.hline(y + 3, 0, TILE - 1, ironDark);
    for (let x = 3; x < TILE; x += 8) t.rect(x, y + 1, 2, 2, ironLit);
  }
  return t;
}

/** Cast down onto whatever floor tile sits directly south of a wall. Drawn as
 *  its own frame rather than baked into the floor variants so it composes with
 *  every theme. */
function drawWallShadow() {
  const t = new Tile();
  const rows = [200, 150, 105, 70, 44, 24, 10];
  for (let i = 0; i < rows.length; i++) {
    t.rect(0, i, TILE, 1, [0x08, 0x09, 0x11], rows[i]);
  }
  return t;
}

// ─── Compose the sheet ───────────────────────────────────────────────────────

const frames = [];
const push = (tile) => frames.push(tile) - 1;

const wallFrameByCanonical = new Map();
for (const mask of CANONICAL) wallFrameByCanonical.set(mask, push(drawWallTile(mask)));

const floorFrames = {};
for (const theme of Object.keys(FLOOR_THEMES)) {
  floorFrames[theme] = [];
  for (let v = 0; v < FLOOR_VARIANTS; v++) floorFrames[theme].push(push(drawFloorTile(theme, v)));
}

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

const themeNames = Object.keys(FLOOR_THEMES);
const ts = `// GENERATED by assets/generate-dungeon-tiles.js — do not edit.
// Frame indices into dungeon-tiles.png. Regenerate with:
//   node assets/generate-dungeon-tiles.js && npm run assets:build

/** Every floor look the dungeon has. Room types map onto these in TileRenderer. */
export type FloorTheme = ${themeNames.map((t) => `"${t}"`).join(" | ")};

export const FLOOR_VARIANT_FRAMES: Record<FloorTheme, readonly number[]> = {
${themeNames.map((t) => `  ${t}: [${floorFrames[t].join(", ")}],`).join("\n")}
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

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

fs.writeFileSync(OUT_TS, ts);

console.log(
  `dungeon-tiles.png: ${frames.length} frames (${CANONICAL.length} wall, ` +
  `${themeNames.length}x${FLOOR_VARIANTS} floor, ${Object.keys(special).length} special) ` +
  `at ${png.width}x${png.height}`,
);
console.log(`tilesetFrames.generated.ts written`);
