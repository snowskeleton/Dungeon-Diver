export type Facing = "up" | "down" | "left" | "right";
export type AiState = "patrol" | "chase" | "attack";

export type TileEffect = "damage" | "slow" | null;

export interface TileProps {
  walkable: boolean;
  effect?: TileEffect;
  effectAmount?: number;   // HP per second for damage
  speedMultiplier?: number; // 0-1 for slow
}

// Client → server input message
export interface InputMessage {
  dx: number;       // -1, 0, or 1
  dy: number;
  attack: boolean;
}

// Tile IDs
export const TILE = {
  FLOOR: 0,
  WALL: 1,
  FIRE: 2,
  SLIME: 3,
  STAIRS: 4,
  BOSS_FLOOR: 5, // passageway tiles leading into the boss room — rendered gold
  TRAP: 6,       // warps the whole party forward TRAP_MIN..TRAP_MAX_FLOORS — visible, so it's avoidable
} as const;

export type TileId = typeof TILE[keyof typeof TILE];

export const TILE_PROPS: Record<TileId, TileProps> = {
  [TILE.FLOOR]:      { walkable: true },
  [TILE.WALL]:       { walkable: false },
  [TILE.FIRE]:       { walkable: true, effect: "damage", effectAmount: 20 },
  [TILE.SLIME]:      { walkable: true, effect: "slow", speedMultiplier: 0.35 },
  [TILE.STAIRS]:     { walkable: true },
  [TILE.BOSS_FLOOR]: { walkable: true },
  // No tile `effect`: the warp is a floor-level event, not a per-entity effect
  // like fire or slime, so GameRoom watches for it rather than applyTileEffects.
  [TILE.TRAP]:       { walkable: true },
};

// A trap warps the party this many floors forward, inclusive. Skipping a floor
// means skipping its loot, shops and shrines while the difficulty climbs anyway —
// the tile is rendered in plain sight so stepping on one is a mistake, not a coin flip.
export const TRAP_MIN_FLOORS = 1;
export const TRAP_MAX_FLOORS = 3;

export type RoomType =
  | "combat"
  | "maze"
  | "boss"
  | "shop"
  | "shrine"
  | "chest"
  | "wave"
  | "timed"
  | "dark";

// Server → client messages
export interface FloorChangeMessage {
  seed: number;
  floor: number;
  spawnX: number;
  spawnY: number;
}

export const TILE_SIZE = 32;

/** World position of a tile's centre. Entities and props are positioned at tile
 *  centres, so `col * TILE_SIZE + TILE_SIZE / 2` was written out in half a dozen
 *  files. Adopted opportunistically — there is no value in a mechanical sweep. */
export function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}
// Damage tiles (fire) apply effectAmount HP-per-second in discrete ticks this far apart.
export const TILE_DAMAGE_INTERVAL_MS = 500;
// Knockback model: `overage = force − knockbackResistance`. overage ≤ 0 means the
// hit failed to clear the enemy's resistance → NO push and NO stun (heavy enemies
// shrug off weak hits). Above the threshold, push distance and stun both scale
// with overage. The stun (suppresses the enemy's chase for a moment) is what makes
// even a small clear read — otherwise the enemy immediately walks back into the push.
export const KNOCKBACK_SCALE = 6;            // px of push per unit of overage
// A hit that FAILS to clear resistance still nudges, for this fraction of its raw
// force, and never stuns (playtest B12). Without the floor, resistance is a binary
// wall: GooGold resists 8, so daggers (4), rapiers (5), swords (7) and spears (8)
// all bounced off it with no reaction at all and read as "that enemy is immune to
// knockback". Heavy enemies should shrug off light hits, not ignore them.
export const KNOCKBACK_MIN_FRACTION = 0.3;
export const KNOCKBACK_STUN_MS_PER_UNIT = 60; // ms of stun per unit of overage
export const KNOCKBACK_STUN_MAX_MS = 3000;    // cap so big hits don't stun-lock forever
export const SERVER_TICK_MS = 50;   // 20 Hz
export const MAX_CLIENTS = 4;
// Physics body geometry (simulated in server PhysicsWorld). Shared so the client
// debug overlay can draw the exact collision circle the server uses: a circle of
// ENTITY_RADIUS at the sprite's FEET (state.y + FOOT_OFFSET).
export const FOOT_OFFSET = 8;
export const ENTITY_RADIUS = 5;

// How much of an entity can be HURT is deliberately NOT how much of it blocks
// movement. ENTITY_RADIUS above is a 5px circle at the feet — what an entity
// walks and collides with. What it can be DAMAGED on is its drawn sprite, and
// that isn't a constant: it's MEASURED per creature from the spritesheet and
// lives in shared/enemies/hurtBounds.generated.ts (ENEMY_HURT_BOUNDS /
// PLAYER_HURT_BOUNDS), produced by assets/generate-enemy-hurtboxes.ts.

// Cruising altitude (px) a flying boss holds above the ground plane. The server
// keeps EnemyState.airHeight here between attacks; the client lifts the sprite by
// it and scales a shadow beneath. A swoop drives it to 0 (claws at the floor) and
// back. Shared so the height→dive-frame mapping and the shadow agree.
export const FLYING_CRUISE_HEIGHT = 44;

// Enemy count per combat/maze room: base + floor(floorNum/2), then scaled by player count.
export const ENEMY_BASE_COUNT = 3;
export const ENEMY_FLOOR_BONUS_INTERVAL = 2; // +1 enemy per this many floors
export const ENEMY_PLAYER_SCALE = 0.25;      // +25% per extra player beyond 1
