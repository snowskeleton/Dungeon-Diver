import { DebugConfig, DEFAULT_DEBUG_CONFIG, EnemyType, RoomType, UPGRADE_IDS } from "shared";
import { CLIENT_ENEMY_REGISTRY } from "../enemies";
import { FieldSpec, Preset } from "../ui/FieldPanel";

// ─────────────────────────────────────────────────────────────────────────────
// The Debug menu, as data. To add a knob:
//   1. add the property to DebugConfig in shared/src/debug.ts (+ a default)
//   2. add one entry to DEBUG_FIELDS below
//   3. teach the server to read it (GameRoom) or map it into DungeonOptions
// Nothing else needs to change — the panel renders itself from this list.
// ─────────────────────────────────────────────────────────────────────────────

const ROOM_TYPES: RoomType[] = [
  "combat",
  "maze",
  "boss",
  "shop",
  "shrine",
  "chest",
  "wave",
  "timed",
  "dark",
];

const ROOM_TYPE_CHOICES = [
  { value: "random", label: "Random (normal)" },
  ...ROOM_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })),
];

// Every creature is selectable, bosses included — a selected boss spawns as its
// real Boss class (in whatever rooms get populated), which is how you test a
// specific boss without relying on the floor-rotated boss room. Bosses are
// labeled so they're easy to spot; they stay out of the *random* spawn pool.
// Ids only — the human-readable name lives on the server-side Upgrade class, and
// this is a debug knob, so the id is a fine label.
const UPGRADE_CHOICES = UPGRADE_IDS.map((id) => ({ value: id, label: id }));

const ENEMY_CHOICES = (Object.keys(CLIENT_ENEMY_REGISTRY) as EnemyType[])
  .map((id) => {
    const def = CLIENT_ENEMY_REGISTRY[id];
    return { value: id, label: def.isBoss ? `${def.name} (boss)` : def.name };
  });

export const DEBUG_FIELDS: FieldSpec<DebugConfig>[] = [
  {
    kind: "number", key: "seed", label: "Seed", min: 0,
    help: "0 uses the normal map seed",
  },
  { kind: "number", key: "gridCols", label: "Rooms across", min: 1, max: 5 },
  { kind: "number", key: "gridRows", label: "Rooms down", min: 1, max: 4 },
  {
    kind: "select", key: "roomType", label: "Room type", options: ROOM_TYPE_CHOICES,
    help: "Forces every room to this type. With a 1×1 grid: a 3-room showcase (start → this → exit)",
  },
  {
    kind: "toggle", key: "includeBoss", label: "Boss room",
    help: "Ignored on single-room and showcase floors",
  },
  {
    kind: "toggle", key: "includeStairs", label: "Stairs",
    help: "Off = no way to descend (reload to restart)",
  },
  {
    kind: "multiselect", key: "enemyTypes", label: "Enemy types", options: ENEMY_CHOICES,
    help: "None selected = every type",
  },
  {
    kind: "number", key: "enemiesPerRoom", label: "Enemies per room", min: -1, max: 30,
    help: "-1 = normal formula (combat/maze rooms only). 0+ fills every room.",
  },
  {
    kind: "multiselect", key: "startingUpgrades", label: "Starting upgrades", options: UPGRADE_CHOICES,
    help: "Granted to every player on join, for testing stat folding",
  },
];

// One-click setups. Each overwrites the whole draft, so spell out every field
// you care about; anything omitted keeps its current value in the panel.
export const DEBUG_PRESETS: Preset<DebugConfig>[] = [
  {
    label: "Combat showcase",
    values: { ...DEFAULT_DEBUG_CONFIG, enabled: true, gridCols: 1, gridRows: 1, roomType: "combat" },
  },
  {
    label: "Bat arena",
    values: {
      ...DEFAULT_DEBUG_CONFIG, enabled: true, gridCols: 1, gridRows: 1,
      roomType: "combat", enemyTypes: ["bat"], enemiesPerRoom: 8,
    },
  },
  {
    label: "Empty maze",
    values: {
      ...DEFAULT_DEBUG_CONFIG, enabled: true, gridCols: 1, gridRows: 1,
      roomType: "maze", enemiesPerRoom: 0,
    },
  },
  {
    label: "Shop showcase",
    values: {
      ...DEFAULT_DEBUG_CONFIG, enabled: true, gridCols: 1, gridRows: 1,
      roomType: "shop", enemiesPerRoom: 0,
    },
  },
  {
    label: "Chest showcase",
    values: {
      ...DEFAULT_DEBUG_CONFIG, enabled: true, gridCols: 1, gridRows: 1,
      roomType: "chest", enemiesPerRoom: 0,
    },
  },
  {
    label: "Gold goo, no walls",
    values: {
      ...DEFAULT_DEBUG_CONFIG, enabled: true, gridCols: 1, gridRows: 1,
      roomType: "shrine", enemyTypes: ["goo-gold"], enemiesPerRoom: 3,
    },
  },
];

const STORAGE_KEY = "game2.debugConfig";

/** Last-used debug config, so the menu reopens where you left it. */
export function loadDebugConfig(): DebugConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_DEBUG_CONFIG, ...JSON.parse(raw) };
  } catch {
    // Corrupt or unavailable storage — fall back to defaults.
  }
  return { ...DEFAULT_DEBUG_CONFIG };
}

export function saveDebugConfig(cfg: DebugConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Non-fatal: the menu just won't remember next time.
  }
}
