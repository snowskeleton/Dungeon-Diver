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
//   - FLOORS : the dark-blue FLAGSTONE floor — dark stones with darker mortar
//     joints, a few near-identical variants scattered so it isn't a mechanical
//     grid. Lifted from the example composition (the dungeon sheet's floor tiles
//     don't sit on a clean 16px sub-grid). The decorated block/water/panel tiles
//     are 3D OBJECTS that sit ON the floor and cast shadows, NOT floor fill —
//     tiling those was the mistake in a previous pass. All room types share it.
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

const DIR = "/Users/snow/Downloads/Super Overhead Adventure 2";
const SRC_PATH = process.env.SOA2_DUNGEON || `${DIR}/Environments/Dungeon.png`;
// The dungeon SHEET has the walls, but its flagstone floor tiles don't sit on a
// clean 16px sub-grid. The author's own example dungeon does — it's the floor
// laid out correctly — so we lift the floor tiles from there. Same art pack.
const EXAMPLE_PATH = process.env.SOA2_EXAMPLE || `${DIR}/Examples/Zaldo/Example Dungeon.png`;
const OUT_PNG = path.join(__dirname, "dungeon-tiles.png");
const OUT_TS = path.join(__dirname, "..", "client", "src", "map", "tilesetFrames.generated.ts");

for (const [p, env] of [[SRC_PATH, "SOA2_DUNGEON"], [EXAMPLE_PATH, "SOA2_EXAMPLE"]]) {
  if (!fs.existsSync(p)) {
    console.error(`Source not found: ${p}\nSet ${env}=/path/to/file.png`);
    process.exit(1);
  }
}
const SRC = PNG.sync.read(fs.readFileSync(SRC_PATH));
const EX = PNG.sync.read(fs.readFileSync(EXAMPLE_PATH));

/** Sample a pixel from a loaded PNG (with alpha). Out-of-range reads opaque black. */
function pixel(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return [0, 0, 0, 255];
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}
const srcPx = (x, y) => pixel(SRC, x, y);

// ─── Source coordinates (16px tiles), from the BLUE set, verified by preview ───

/** The cyan brick every wall is built from. Tiles seamlessly. Sheet coords. */
const WALL_BRICK = { x: 192, y: 0 };

/** The flagstone palette, sampled from the example floor: it is exactly two
 *  colours, a blue stone and a dark navy mortar. `lit`/`shade` are derived for a
 *  faint hand-carved bevel. */
const STONE = [0x00, 0x52, 0x80];
const MORTAR = [0x21, 0x16, 0x40];
const STONE_LIT = [0x2a, 0x74, 0xa0];
const STONE_SHADE = [0x00, 0x3a, 0x60];

// The renderer keys floors by room-type "theme". We only use the blue set right
// now, so every theme resolves to the same blue floor — but the keys stay so the
// exhaustive switch in TileRenderer still compiles and a second colour set can be
// slotted in per theme later without touching the renderer.
const THEME_NAMES = ["stone", "maze", "shop", "shrine", "chest", "boss"];

// ─── Drawing surface (square, `size` px; TILE by default) ──────────────────────

class Tile {
  constructor(size = TILE) {
    this.size = size;
    this.data = new Uint8Array(size * size * 4);
  }
  idx(x, y) {
    return (y * this.size + x) * 4;
  }
  px(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
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
    this.rect(0, 0, this.size, this.size, c);
  }
  hline(y, x0, x1, c, a = 255) {
    for (let x = x0; x <= x1; x++) this.px(x, y, c, a);
  }
  vline(x, y0, y1, c, a = 255) {
    for (let y = y0; y <= y1; y++) this.px(x, y, c, a);
  }
  /** Copy the 32×32 region at (ox,oy) of this surface into a new TILE-sized tile. */
  quadrant(ox, oy) {
    const out = new Tile(TILE);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const s = this.idx(ox + x, oy + y);
        const d = out.idx(x, y);
        out.data[d] = this.data[s];
        out.data[d + 1] = this.data[s + 1];
        out.data[d + 2] = this.data[s + 2];
        out.data[d + 3] = this.data[s + 3];
      }
    }
    return out;
  }
  /** Blit a SRC_TILE-sized tile from a PNG, scaled to fill this square tile. */
  blit(png, sx, sy) {
    const scale = this.size / SRC_TILE;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const [r, g, b] = pixel(png, sx + Math.floor(x / scale), sy + Math.floor(y / scale));
        this.px(x, y, [r, g, b]);
      }
    }
  }
  /** Blit from the dungeon sheet (walls, specials). */
  blitSource(sx, sy) {
    this.blit(SRC, sx, sy);
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

// ─── Floor: hand-placed flagstones ─────────────────────────────────────────────
//
// The example's floor is stones inset in mortar. We reproduce it — in the exact
// two-colour palette — but push the irregularity further than the source: every
// stone is a touch smaller than its slot, nudged off-centre, and rotated a few
// degrees, so the floor reads as "someone laid these by hand" rather than a grid.
// Three stone sizes (tiny / regular / large); the renderer mixes them per room.
//
// Each variant bakes a different jitter/rotation, and the renderer scatters the
// variants, so no two neighbouring slots look placed the same way.

/** Is local point (lx,ly) inside a rounded rect of half-extents hw,hh, radius r? */
function insideRoundRect(lx, ly, hw, hh, r) {
  const ax = Math.abs(lx);
  const ay = Math.abs(ly);
  if (ax > hw || ay > hh) return false;
  if (ax <= hw - r || ay <= hh - r) return true;
  const dx = ax - (hw - r);
  const dy = ay - (hh - r);
  return dx * dx + dy * dy <= r * r;
}

/** Stamp one flagstone onto a surface: a rounded rect in STONE, rotated by
 *  `angle`° about (cx,cy), with a 1px lit top-left and shaded bottom-right edge
 *  for a hand-carved bevel. The surface must already be filled with MORTAR. */
function stampStone(surf, cx, cy, w, h, angle, radius) {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(-a);
  const sin = Math.sin(-a);
  const hw = w / 2;
  const hh = h / 2;
  const reach = Math.ceil(Math.max(hw, hh) + 2);
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (!insideRoundRect(lx, ly, hw, hh, radius)) continue;
      let c = STONE;
      const edge = 1.4;
      if (lx < -hw + edge || ly < -hh + edge) c = STONE_LIT;
      else if (lx > hw - edge || ly > hh - edge) c = STONE_SHADE;
      surf.px(x, y, c);
    }
  }
}

/** Deterministic jitter helper: a seeded generator plus small signed noise. */
function stoneRng(seed) {
  const r = rng(seed);
  return {
    // signed value in [-m, m]
    j: (m) => (r() * 2 - 1) * m,
    // value in [a, b]
    range: (a, b) => a + r() * (b - a),
  };
}

/** One 32px cell holding a single ~regular flagstone. */
function drawRegular(seed) {
  const t = new Tile(TILE);
  t.fill(MORTAR);
  const g = stoneRng(seed);
  stampStone(t, 16 + g.j(2.2), 16 + g.j(2.2), g.range(24, 27), g.range(24, 27), g.j(5), 4);
  return t;
}

/** One 32px cell holding a 2×2 of tiny flagstones. */
function drawTiny(seed) {
  const t = new Tile(TILE);
  t.fill(MORTAR);
  const g = stoneRng(seed);
  for (const [cx, cy] of [[8, 8], [24, 8], [8, 24], [24, 24]]) {
    stampStone(t, cx + g.j(1.6), cy + g.j(1.6), g.range(10, 12.5), g.range(10, 12.5), g.j(8), 2);
  }
  return t;
}

/** One large flagstone spanning a 2×2 block (64px), sliced into four 32px
 *  quadrant tiles [tl, tr, bl, br] the renderer lays in a 2×2 group. */
function drawLargeQuads(seed) {
  const surf = new Tile(64);
  surf.fill(MORTAR);
  const g = stoneRng(seed);
  stampStone(surf, 32 + g.j(3), 32 + g.j(3), g.range(52, 57), g.range(52, 57), g.j(3.5), 7);
  return [surf.quadrant(0, 0), surf.quadrant(32, 0), surf.quadrant(0, 32), surf.quadrant(32, 32)];
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

/** The gold passage into a boss room — a flagstone with gold veins on top. */
function drawBossFloor() {
  const t = drawRegular(0x9055);
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

// Flagstone floor variants at three sizes. Many variants so the renderer can
// scatter them and the floor never repeats a placement next to itself.
const FLOOR_TINY = [];
const FLOOR_REGULAR = [];
const FLOOR_LARGE = []; // each entry is [tl, tr, bl, br] frame indices
for (let i = 0; i < 14; i++) FLOOR_REGULAR.push(push(drawRegular(0x5100 + i * 2654435761)));
for (let i = 0; i < 14; i++) FLOOR_TINY.push(push(drawTiny(0x7a00 + i * 2246822519)));
for (let i = 0; i < 8; i++) {
  FLOOR_LARGE.push(drawLargeQuads(0xb500 + i * 3266489917).map((q) => push(q)));
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

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const ts = `// GENERATED by assets/generate-dungeon-tiles.js — do not edit.
// Frame indices into dungeon-tiles.png (walls + floors sampled from the Super
// Overhead Adventure 2 dungeon sheet). Regenerate with:
//   npm run assets:tiles

/** Flagstone floor frames at three sizes. \`large\` entries are 2×2 quadrant sets
 *  [topLeft, topRight, bottomLeft, bottomRight] laid across a 2×2 cell block; the
 *  others are single 32px cells (\`tiny\` = a 2×2 of small stones in one cell). The
 *  renderer picks a size per cell from a per-room plan and scatters the variants.
 *  One colour set for now, so there is no per-room-type palette. */
export const FLOOR_FRAMES = {
  tiny: [${FLOOR_TINY.join(", ")}],
  regular: [${FLOOR_REGULAR.join(", ")}],
  large: [
${FLOOR_LARGE.map((q) => `    [${q.join(", ")}],`).join("\n")}
  ],
} as const;

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

// ─── Preview: a bordered room per floor size ─────────────────────────────────

if (process.env.TILE_PREVIEW) {
  const TW = 9, TH = 8, pad = 8;
  const plans = ["tiny", "regular", "large", "rim"];
  const prev = new PNG({ width: plans.length * (TW * TILE + pad) + pad, height: TH * TILE + pad * 2 });
  prev.data.fill(20);
  const wallMaskFor = (rx, ry) => {
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
  const stamp = (tile, ox, oy) => {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const s = (y * TILE + x) * 4;
        if (tile.data[s + 3] === 0) continue;
        const d = ((oy + y) * prev.width + ox + x) * 4;
        prev.data[d] = tile.data[s];
        prev.data[d + 1] = tile.data[s + 1];
        prev.data[d + 2] = tile.data[s + 2];
        prev.data[d + 3] = 255;
      }
  };
  const hash = (a, b) => {
    let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2545f491); h ^= h >>> 13; return h >>> 0;
  };
  plans.forEach((plan, ti) => {
    const bx = pad + ti * (TW * TILE + pad), by = pad;
    for (let ry = 0; ry < TH; ry++) {
      for (let rx = 0; rx < TW; rx++) {
        if (rx === 0 || ry === 0 || rx === TW - 1 || ry === TH - 1) {
          stamp(frames[maskToFrame[wallMaskFor(rx, ry)]], bx + rx * TILE, by + ry * TILE);
          continue;
        }
        const irx = rx - 1, iry = ry - 1;
        let size = plan;
        if (plan === "rim") size = (irx < 1 || iry < 1 || irx > TW - 4 || iry > TH - 4) ? "tiny" : "large";
        if (size === "large") {
          const bcol = irx >> 1, brow = iry >> 1, q = (iry & 1) * 2 + (irx & 1);
          const set = FLOOR_LARGE[hash(bcol, brow) % FLOOR_LARGE.length];
          stamp(frames[set[q]], bx + rx * TILE, by + ry * TILE);
        } else {
          const pool = size === "tiny" ? FLOOR_TINY : FLOOR_REGULAR;
          stamp(frames[pool[hash(rx, ry) % pool.length]], bx + rx * TILE, by + ry * TILE);
        }
      }
    }
  });
  fs.writeFileSync(process.env.TILE_PREVIEW, PNG.sync.write(prev));
  console.log(`preview -> ${process.env.TILE_PREVIEW}`);
}

console.log(
  `dungeon-tiles.png: ${frames.length} frames (${CANONICAL.length} wall, ` +
  `${FLOOR_TINY.length + FLOOR_REGULAR.length + FLOOR_LARGE.length * 4} floor, ` +
  `${Object.keys(special).length} special) at ${png.width}x${png.height}`,
);
console.log(`tilesetFrames.generated.ts written`);
