import { EnemyType, TILE_SIZE, FLYING_CRUISE_HEIGHT } from "shared";
import { makeSheetEnemyDef, frameRow, frameAt, SheetSpec } from "./sheetEnemy";
import { makeDirectionalEnemyDef } from "./directionalEnemy";
import { defineClips } from "../entities/SpriteClips";
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
    airborne: true,
  });

// The beasts, bones and snakes share a layout: 4×4 @16, one row per facing.
const smallDirectional = (id: string, name: string): ClientEnemyDef =>
  makeDirectionalEnemyDef(id, { name, frameSize: 16, cols: 4, frameRate: 8 });

/** Bosses render at double a normal enemy so they read as a threat. */
const BOSS_SIZE = TILE_SIZE * 2;

type BossSpec = Omit<SheetSpec, "name" | "displayW" | "displayH"> & { displaySize?: number };

const boss = (id: string, name: string, spec: BossSpec): ClientEnemyDef => {
  const { displaySize = BOSS_SIZE, ...sheet } = spec;
  return { ...makeSheetEnemyDef(id, { ...sheet, name, displayW: displaySize, displayH: displaySize }), isBoss: true };
};

// The Turtle Dragon renders its walk row normally but swaps to the spin row
// (frames 10-13) while it channels its Shell Spin dash — the client learns this
// from the boss's abilityId ("shell-spin") passed to resolve as `action`.
function turtleDragonDef(): ClientEnemyDef {
  const base = boss("turtle-dragon", "Turtle Dragon", { frameWidth: 32, cols: 16, moveFrames: frameRow(16, 0, 4, 6) });
  const spinKey = "turtle-dragon-spin";
  return {
    ...base,
    defineAnimations: (scene) => {
      base.defineAnimations(scene);
      defineClips(scene, base.textureKey, {
        [spinKey]: { frames: frameRow(16, 0, 10, 4), frameRate: 16, repeat: -1 },
      });
    },
    // Both the dash and the stationary whirl render as the spin row.
    resolve: (state) =>
      !state.isDying && state.channeling && (state.abilityId === "shell-spin" || state.abilityId === "shell-whirl")
        ? { key: spinKey, flipX: false }
        : base.resolve(state),
  };
}

// The Wyverns fly: their sprite is a 4×2 sheet — row 0 (frames 0-3) flaps for
// normal cruising; row 1 (frames 4-7) is the dive. A swoop coils on frame 3 (the
// wind-up tell), then the dive frame is driven directly by the boss's airHeight —
// full height → frame 4, floor → frame 7 — so it plays 4→7 dropping and, because
// the frame is a pure function of height, auto-reverses 7→4 as it climbs back out.
function wyvernDef(id: string, name: string): ClientEnemyDef {
  const base = boss(id, name, { frameWidth: 32, cols: 4, frameRate: 10 });
  const moveKey = `${id}-move`;
  return {
    ...base,
    airborne: true,
    resolve: (state) => {
      if (state.isDying) return base.resolve(state);
      const flipX = state.facing === "left";
      if (state.abilityId === "swoop") {
        // Coiled and about to dive: hold the last flap frame during the wind-up.
        if (state.telegraph) return { key: moveKey, flipX, frame: 3 };
        if (state.channeling) {
          const t = Math.min(1, Math.max(0, state.airHeight / FLYING_CRUISE_HEIGHT));
          return { key: moveKey, flipX, frame: 4 + Math.round(3 * (1 - t)) };
        }
      }
      return base.resolve(state); // normal flapping
    },
  };
}

// The Tengu Mask drives a distinct sheet row per ability (the client learns which
// from the boss's abilityId): row 1's orb/lightning cast for Storm Nova, row 2's
// dissolve-and-duplicate for Mirror Split, and the row-3 stoneface held through
// the whole Stone Crash (wind-up, flight, and landing lag). Row 0 idle otherwise.
function tenguMaskDef(): ClientEnemyDef {
  const cols = 18;
  const base = boss("tengu-mask", "Tengu", { frameWidth: 32, cols, moveFrames: frameRow(cols, 0, 0, 4), frameRate: 6 });
  const novaKey = "tengu-nova";
  const splitKey = "tengu-split";
  const stoneFrame = frameAt(cols, 3, 0); // row-3 stoneface (single frame)
  return {
    ...base,
    airborne: true, // so the Stone Crash draws a ground shadow while it's aloft
    defineAnimations: (scene) => {
      base.defineAnimations(scene);
      defineClips(scene, base.textureKey, {
        // Play each cast row once so its climax (the nova's white burst, the split's
        // copies) lands late in the wind-up rather than looping.
        [novaKey]: { frames: frameRow(cols, 1, 0, 18), frameRate: 16, repeat: 0 },
        [splitKey]: { frames: frameRow(cols, 2, 0, 13), frameRate: 16, repeat: 0 },
      });
    },
    resolve: (state) => {
      if (state.isDying) return base.resolve(state);
      const flipX = state.facing === "left";
      const casting = state.telegraph || state.channeling;
      if (state.abilityId === "storm-nova" && casting) return { key: novaKey, flipX };
      if (state.abilityId === "mirror-split" && casting) return { key: splitKey, flipX };
      // Stone the whole crash — the abilityId stays set through recovery, so it
      // reads as stone right up to the punish window.
      if (state.abilityId === "stone-drop") return { key: novaKey, flipX, frame: stoneFrame };
      return base.resolve(state); // idle / looking
    },
  };
}

export const CLIENT_ENEMY_REGISTRY: Record<EnemyType, ClientEnemyDef> = {
  // ── Horizontal, single-row strips ────────────────────────────────────────
  "goo-green": makeSheetEnemyDef("goo-green", { name: "Green Goo", frameWidth: 32, cols: 6 }),
  "goo-blue":  makeSheetEnemyDef("goo-blue",  { name: "Blue Goo",  frameWidth: 32, cols: 6 }),
  "goo-gold":  makeSheetEnemyDef("goo-gold",  { name: "Gold Goo",  frameWidth: 32, cols: 6 }),

  "bat":       makeSheetEnemyDef("bat",       { name: "Bat",       frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH, airborne: true }),
  "brown-bat": makeSheetEnemyDef("brown-bat", { name: "Brown Bat", frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH, airborne: true }),
  "eye-bat":   makeSheetEnemyDef("eye-bat",   { name: "Eye Bat",   frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH, airborne: true }),
  "gold-eye":  makeSheetEnemyDef("gold-eye",  { name: "Gold Eye",  frameWidth: 16, cols: 6, frameRate: 10, death: BAT_DEATH, airborne: true }),

  "smushroom": makeSheetEnemyDef("smushroom", { name: "Smushroom", frameWidth: 16, cols: 6 }),
  "float-eye": makeSheetEnemyDef("float-eye", { name: "Float Eye", frameWidth: 16, cols: 4, frameRate: 6, airborne: true }),

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
  // Each sheet's rows/columns are described in its .txt in the art pack. Bosses
  // with a real moveset drive their special rows from the boss's abilityId /
  // airHeight (see turtleDragonDef, wyvernDef); the rest still only animate the
  // locomotion clip until they get movesets.

  // 16×1 @32: cols 0-3 idle, 4-9 walk, 10-13 spin, 14-15 damage. The spin row
  // plays while it channels its Shell Spin dash (abilityId "shell-spin").
  "turtle-dragon": turtleDragonDef(),

  // 4×2 @32: row 0 flap (cruising), row 1 the diving swoop (see wyvernDef).
  "wyvern":       wyvernDef("wyvern",       "Wyvern"),
  "wyvern-green": wyvernDef("wyvern-green", "Green Wyvern"),
  "wyvern-grey":  wyvernDef("wyvern-grey",  "Grey Wyvern"),

  // 8×4 @32: row 0 idle (4), row 1 gallop (4), row 2 club, row 3 lance.
  "centaur-knight": boss("centaur-knight", "Centaur Knight", {
    frameWidth: 32, cols: 8, moveFrames: frameRow(8, 1, 0, 4),
  }),

  // 8×4 @32: row 0 idle (6), row 1 walk (8), row 2 hit/throw, row 3 roll.
  "big-beast": boss("big-beast", "Big Beast", {
    frameWidth: 32, cols: 8, moveFrames: frameRow(8, 1, 0, 8),
  }),

  // 18×4 @32: row 0 idle/looking, rows 1-2 spellcasting, row 3 stoneface (see below).
  "tengu-mask": tenguMaskDef(),

  // The Tengu's Mirror Split copies: the same sheet's idle row (row 0), rendered at
  // half the boss size — a "smaller version of himself". Summon-only.
  "tengu-shade": makeSheetEnemyDef("tengu-shade", {
    name: "Tengu Shade",
    textureKey: "tengu-mask",
    frameWidth: 32,
    cols: 18,
    moveFrames: frameRow(18, 0, 0, 4),
    displayW: TILE_SIZE,
    displayH: TILE_SIZE,
    frameRate: 6,
  }),

  // 8×6 @40: row 0 idle (4), row 1 walk (8), then breath/crouch/flap/stomp.
  "batwing-buttstomper": boss("batwing-buttstomper", "Batwing Buttstomper", {
    frameWidth: 40, cols: 8, moveFrames: frameRow(8, 1, 0, 8), displaySize: BOSS_SIZE + 16,
  }),
};

export const ENEMY_TYPES = Object.keys(CLIENT_ENEMY_REGISTRY) as EnemyType[];
