import { EnemyType, TILE_SIZE } from "shared";
import { makeSheetEnemyDef, frameRow, SheetSpec } from "./sheetEnemy";
import { makeDirectionalEnemyDef } from "./directionalEnemy";
import { ClientEnemyDef } from "./types";

export * from "./types";

// Bats collapse mid-flap rather than rewinding the whole cycle.
const BAT_DEATH = { frames: [5, 4, 3], frameRate: 8 };

// float-skull.png is 3 cols × 3 rows @16: one row per colour. Cols 0-1 are the
// aura pulse, col 2 is the white flash — reused as the death frame.
const floatSkull = (id: string, name: string, row: number): ClientEnemyDef =>
  makeSheetEnemyDef(id, {
    name,
    textureKey: "float-skull",
    frameWidth: 16,
    cols: 3,
    moveFrames: frameRow(3, row, 0, 2),
    death: { frames: frameRow(3, row, 2, 1), frameRate: 6 },
    frameRate: 6,
  });

// The beasts, bones and snakes share a layout: 4×4 @16, one row per facing.
const smallDirectional = (id: string, name: string): ClientEnemyDef =>
  makeDirectionalEnemyDef(id, { name, frameSize: 16, cols: 4, frameRate: 8 });

/** Bosses render at double a normal enemy so they read as a threat. */
const BOSS_SIZE = TILE_SIZE * 2;

type BossSpec = Omit<SheetSpec, "name" | "displayW" | "displayH"> & { displaySize?: number };

const boss = (id: string, name: string, spec: BossSpec): ClientEnemyDef => {
  const { displaySize = BOSS_SIZE, ...sheet } = spec;
  return makeSheetEnemyDef(id, { ...sheet, name, displayW: displaySize, displayH: displaySize });
};

export const CLIENT_ENEMY_REGISTRY: Record<EnemyType, ClientEnemyDef> = {
  // ── Horizontal, single-row strips ────────────────────────────────────────
  "goo-green": makeSheetEnemyDef("goo-green", { name: "Green Goo", frameWidth: 32, cols: 6 }),
  "goo-blue":  makeSheetEnemyDef("goo-blue",  { name: "Blue Goo",  frameWidth: 32, cols: 6 }),
  "goo-gold":  makeSheetEnemyDef("goo-gold",  { name: "Gold Goo",  frameWidth: 32, cols: 6 }),

  "bat":       makeSheetEnemyDef("bat",       { name: "Bat",       frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH }),
  "brown-bat": makeSheetEnemyDef("brown-bat", { name: "Brown Bat", frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH }),
  "eye-bat":   makeSheetEnemyDef("eye-bat",   { name: "Eye Bat",   frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH }),
  "gold-eye":  makeSheetEnemyDef("gold-eye",  { name: "Gold Eye",  frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH }),

  "smushroom": makeSheetEnemyDef("smushroom", { name: "Smushroom", frameWidth: 16, cols: 6 }),
  "float-eye": makeSheetEnemyDef("float-eye", { name: "Float Eye", frameWidth: 16, cols: 4, frameRate: 6 }),

  "swarm-1":   makeSheetEnemyDef("swarm-1",   { name: "Small Swarm", frameWidth: 16, cols: 4, frameRate: 12 }),
  "swarm-2":   makeSheetEnemyDef("swarm-2",   { name: "Swarm",       frameWidth: 16, cols: 4, frameRate: 12 }),
  "swarm-3":   makeSheetEnemyDef("swarm-3",   { name: "Dense Swarm", frameWidth: 16, cols: 4, frameRate: 12 }),

  "rat":       makeSheetEnemyDef("rat", { name: "Rat", frameWidth: 20, cols: 8, frameRate: 12 }),

  // ── Horizontal, multi-row sheets ─────────────────────────────────────────
  // spider.png is 6×3 of 32×16 cells: row 0 idle (6), row 1 walk (4), row 2 jump (4).
  "spider": makeSheetEnemyDef("spider", {
    name: "Spider",
    frameWidth: 32, frameHeight: 16, cols: 6,
    moveFrames: frameRow(6, 1, 0, 4),
    displayW: 32, displayH: 16,
    frameRate: 10,
  }),

  // frog-flower.png is 4×3 @32: row 0 idle (4), row 1 jump (4), row 2 fall (1).
  "frog-flower": makeSheetEnemyDef("frog-flower", {
    name: "Frog Flower", frameWidth: 32, cols: 4, moveFrames: frameRow(4, 0, 0, 4), frameRate: 6,
  }),
  "frog-flower-black": makeSheetEnemyDef("frog-flower-black", {
    name: "Black Frog Flower", frameWidth: 32, cols: 4, moveFrames: frameRow(4, 0, 0, 4), frameRate: 6,
  }),

  "float-skull":      floatSkull("float-skull",      "Float Skull",      0),
  "float-skull-teal": floatSkull("float-skull-teal", "Teal Float Skull", 1),
  "float-skull-pink": floatSkull("float-skull-pink", "Pink Float Skull", 2),

  // ── Directional ──────────────────────────────────────────────────────────
  "bones":        smallDirectional("bones",        "Bones"),
  "bones-blader": smallDirectional("bones-blader", "Bones Blader"),
  "kultist":      smallDirectional("kultist",      "Kultist"),
  "armor-lancer": smallDirectional("armor-lancer", "Armor Lancer"),
  "beast":        smallDirectional("beast",        "Beast"),
  "axe-beast":    smallDirectional("axe-beast",    "Axe Beast"),
  "mace-beast":   smallDirectional("mace-beast",   "Mace Beast"),
  "sword-beast":  smallDirectional("sword-beast",  "Sword Beast"),
  "fang":         smallDirectional("fang",         "Fang"),
  "hood-fang":    smallDirectional("hood-fang",    "Hood Fang"),

  // ── Bosses ───────────────────────────────────────────────────────────────
  // Each sheet's rows/columns are described in its .txt in the art pack. We only
  // animate the locomotion clip; the attack/special rows are unused until bosses
  // get real movesets.

  // 16×1 @32: cols 0-3 idle, 4-9 walk, 10-13 spin, 14-15 damage.
  "turtle-dragon": boss("turtle-dragon", "Turtle Dragon", {
    frameWidth: 32, cols: 16, moveFrames: frameRow(16, 0, 4, 6),
  }),

  // 4×2 @32: row 0 flap, row 1 breath.
  "wyvern":       boss("wyvern",       "Wyvern",       { frameWidth: 32, cols: 4, frameRate: 10 }),
  "wyvern-green": boss("wyvern-green", "Green Wyvern", { frameWidth: 32, cols: 4, frameRate: 10 }),
  "wyvern-grey":  boss("wyvern-grey",  "Grey Wyvern",  { frameWidth: 32, cols: 4, frameRate: 10 }),

  // 8×4 @32: row 0 idle (4), row 1 gallop (4), row 2 club, row 3 lance.
  "centaur-knight": boss("centaur-knight", "Centaur Knight", {
    frameWidth: 32, cols: 8, moveFrames: frameRow(8, 1, 0, 4),
  }),

  // 8×4 @32: row 0 idle (6), row 1 walk (8), row 2 hit/throw, row 3 roll.
  "big-beast": boss("big-beast", "Big Beast", {
    frameWidth: 32, cols: 8, moveFrames: frameRow(8, 1, 0, 8),
  }),

  // 18×4 @32: row 0 idle/looking (4), rows 1-2 spellcasting, row 3 stoneface.
  "tengu-mask": boss("tengu-mask", "Tengu", {
    frameWidth: 32, cols: 18, moveFrames: frameRow(18, 0, 0, 4), frameRate: 6,
  }),

  // 8×6 @40: row 0 idle (4), row 1 walk (8), then breath/crouch/flap/stomp.
  "batwing-buttstomper": boss("batwing-buttstomper", "Batwing Buttstomper", {
    frameWidth: 40, cols: 8, moveFrames: frameRow(8, 1, 0, 8), displaySize: BOSS_SIZE + 16,
  }),
};

export const ENEMY_TYPES = Object.keys(CLIENT_ENEMY_REGISTRY) as EnemyType[];
