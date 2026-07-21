import { EnemyType, TILE_SIZE } from "shared";

// Where every enemy's sprite geometry lives — deliberately FREE OF PHASER.
//
// Two consumers need this data and only one of them runs in a browser:
//   1. the visual defs (client/src/enemies/*.ts), which build Phaser animations;
//   2. assets/generate-enemy-hurtboxes.ts, a build script that opens the PNGs and
//      measures each enemy's drawn extent to derive its hurt bounds.
//
// The generator can't import the visual defs — Phaser throws `window is not
// defined` the moment it's required in Node — so the geometry had to come out of
// those modules and live somewhere importable by both. That's this file. It is
// the SINGLE definition: the factories read their frame layout from here rather
// than taking it inline, so the numbers the generator measures against are
// necessarily the numbers the client renders with.
//
// `frames` is the frame indices this enemy actually occupies, which is not always
// the whole sheet — the three float-skull colours are three ROWS of one PNG, and
// the bosses' locomotion is one row of many. The generator measures exactly these
// frames, so a shared sheet gives each enemy its own bounds.

export interface SpriteGeometry {
  /** Spritesheet texture key (several enemies can share one sheet). */
  textureKey: string;
  /** Source cell size in px. */
  frameWidth: number;
  frameHeight: number;
  /** Cells per sheet row — turns (row, col) into a frame index. */
  cols: number;
  /** The frame indices this enemy draws with (its locomotion clip). */
  frames: number[];
  /** On-screen size in px; the art is scaled from the source cell to this. */
  displayW: number;
  displayH: number;
}

/** Frame index of (row, col) on a sheet `cols` cells wide. */
export const frameAt = (cols: number, row: number, col: number) => row * cols + col;
/** `count` consecutive frame indices starting at (row, startCol). */
export const frameRow = (cols: number, row: number, startCol: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => frameAt(cols, row, startCol + i));

/** A horizontal strip: the whole first row, square cells, one tile on screen. */
function strip(cols: number, frameWidth: number, over: Partial<SpriteGeometry> = {}): Omit<SpriteGeometry, "textureKey"> {
  return {
    frameWidth,
    frameHeight: frameWidth,
    cols,
    frames: frameRow(cols, 0, 0, cols),
    displayW: TILE_SIZE,
    displayH: TILE_SIZE,
    ...over,
  };
}

/** A 4-row directional sheet: one row per facing, all rows drawn. */
function directional(cols: number, frameSize: number, displaySize = TILE_SIZE): Omit<SpriteGeometry, "textureKey"> {
  return {
    frameWidth: frameSize,
    frameHeight: frameSize,
    cols,
    // Every row is a facing this enemy really renders, so the hurt bounds are the
    // union across all four — a hurtbox must not change with which way you face.
    frames: Array.from({ length: cols * 4 }, (_, i) => i),
    displayW: displaySize,
    displayH: displaySize,
  };
}

/** Bosses render at double a normal enemy so they read as a threat. */
export const BOSS_SIZE = TILE_SIZE * 2;

function bossSheet(
  cols: number,
  frameWidth: number,
  frames: number[],
  displaySize = BOSS_SIZE,
): Omit<SpriteGeometry, "textureKey"> {
  return {
    frameWidth,
    frameHeight: frameWidth,
    cols,
    frames,
    displayW: displaySize,
    displayH: displaySize,
  };
}

// The Record<EnemyType, …> annotation is what makes this safe: a new enemy id
// with no geometry entry is a compile error, not a creature with a silently wrong
// hurtbox. Same guarantee CLIENT_ENEMY_REGISTRY gives for visuals.
export const ENEMY_SPRITE_GEOMETRY: Record<EnemyType, SpriteGeometry> = {
  // ── Horizontal, single-row strips ──────────────────────────────────────────
  "goo-green": { textureKey: "goo-green", ...strip(6, 32) },
  "goo-blue": { textureKey: "goo-blue", ...strip(6, 32) },
  "goo-gold": { textureKey: "goo-gold", ...strip(6, 32) },

  "bat": { textureKey: "bat", ...strip(6, 16) },
  "brown-bat": { textureKey: "brown-bat", ...strip(6, 16) },
  "eye-bat": { textureKey: "eye-bat", ...strip(6, 16) },
  "gold-eye": { textureKey: "gold-eye", ...strip(6, 16) },

  "smushroom": { textureKey: "smushroom", ...strip(6, 16) },
  "float-eye": { textureKey: "float-eye", ...strip(4, 16) },

  "swarm-1": { textureKey: "swarm-1", ...strip(4, 16) },
  "swarm-2": { textureKey: "swarm-2", ...strip(4, 16) },
  "swarm-3": { textureKey: "swarm-3", ...strip(4, 16) },

  "rat": { textureKey: "rat", ...strip(8, 20) },

  // ── Horizontal, multi-row sheets ───────────────────────────────────────────
  // spider.png is 6×3 of 32×16 cells: row 0 idle, row 1 walk (4), row 2 jump.
  "spider": {
    textureKey: "spider",
    ...strip(6, 32, {
      frameHeight: 16,
      frames: frameRow(6, 1, 0, 4),
      displayH: 16,
    }),
  },
  // frog-flower.png is 4×3 @32: row 0 idle (4), row 1 jump, row 2 fall.
  "frog-flower": { textureKey: "frog-flower", ...strip(4, 32, { frames: frameRow(4, 0, 0, 4) }) },
  "frog-flower-black": { textureKey: "frog-flower-black", ...strip(4, 32, { frames: frameRow(4, 0, 0, 4) }) },

  // float-skull.png is 3 cols × 3 rows @16 — ONE ROW PER COLOUR. Cols 0-1 are the
  // aura pulse (the locomotion clip), col 2 the white flash reused for death.
  "float-skull": { textureKey: "float-skull", ...strip(3, 16, { frames: frameRow(3, 0, 0, 2) }) },
  "float-skull-teal": { textureKey: "float-skull", ...strip(3, 16, { frames: frameRow(3, 1, 0, 2) }) },
  "float-skull-pink": { textureKey: "float-skull", ...strip(3, 16, { frames: frameRow(3, 2, 0, 2) }) },

  // The Tengu's Mirror Split copy: the boss's own sheet, idle row, at enemy size.
  "tengu-shade": {
    textureKey: "tengu-mask",
    ...strip(18, 32, { frames: frameRow(18, 0, 0, 4) }),
  },

  // ── Directional (up/right/down/left rows) ──────────────────────────────────
  "bones": { textureKey: "bones", ...directional(4, 16) },
  "bones-blader": { textureKey: "bones-blader", ...directional(4, 16) },
  "kultist": { textureKey: "kultist", ...directional(4, 16) },
  "armor-lancer": { textureKey: "armor-lancer", ...directional(4, 16) },
  "beast": { textureKey: "beast", ...directional(4, 16) },
  "axe-beast": { textureKey: "axe-beast", ...directional(4, 16) },
  "mace-beast": { textureKey: "mace-beast", ...directional(4, 16) },
  "sword-beast": { textureKey: "sword-beast", ...directional(4, 16) },
  "fang": { textureKey: "fang", ...directional(4, 16) },
  "hood-fang": { textureKey: "hood-fang", ...directional(4, 16) },

  // ── Bosses ────────────────────────────────────────────────────────────────
  // 16×1 @32: cols 0-3 idle, 4-9 walk, 10-13 spin, 14-15 damage.
  "turtle-dragon": { textureKey: "turtle-dragon", ...bossSheet(16, 32, frameRow(16, 0, 4, 6)) },
  // 4×2 @32: row 0 flap, row 1 dive.
  "wyvern": { textureKey: "wyvern", ...bossSheet(4, 32, frameRow(4, 0, 0, 4)) },
  "wyvern-green": { textureKey: "wyvern-green", ...bossSheet(4, 32, frameRow(4, 0, 0, 4)) },
  "wyvern-grey": { textureKey: "wyvern-grey", ...bossSheet(4, 32, frameRow(4, 0, 0, 4)) },
  // 8×4 @32: row 0 idle (4), row 1 gallop (4), row 2 club, row 3 lance.
  "centaur-knight": { textureKey: "centaur-knight", ...bossSheet(8, 32, frameRow(8, 1, 0, 4)) },
  // 8×4 @32: row 0 idle, row 1 walk (8), row 2 hit/throw, row 3 roll.
  "big-beast": { textureKey: "big-beast", ...bossSheet(8, 32, frameRow(8, 1, 0, 8)) },
  // 18×4 @32: row 0 idle/looking, rows 1-2 spellcasting, row 3 stoneface.
  "tengu-mask": { textureKey: "tengu-mask", ...bossSheet(18, 32, frameRow(18, 0, 0, 4)) },
  // 8×6 @40: row 0 idle, row 1 walk (8), then breath/crouch/flap/stomp.
  "batwing-buttstomper": {
    textureKey: "batwing-buttstomper",
    ...bossSheet(8, 40, frameRow(8, 1, 0, 8), BOSS_SIZE + 16),
  },
};
