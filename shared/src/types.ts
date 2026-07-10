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
} as const;

export type TileId = typeof TILE[keyof typeof TILE];

export const TILE_PROPS: Record<TileId, TileProps> = {
  [TILE.FLOOR]:      { walkable: true },
  [TILE.WALL]:       { walkable: false },
  [TILE.FIRE]:       { walkable: true, effect: "damage", effectAmount: 20 },
  [TILE.SLIME]:      { walkable: true, effect: "slow", speedMultiplier: 0.35 },
  [TILE.STAIRS]:     { walkable: true },
  [TILE.BOSS_FLOOR]: { walkable: true },
};

export type RoomType = "combat" | "maze" | "boss" | "shop" | "shrine";

// Server → client messages
export interface FloorChangeMessage {
  seed: number;
  floor: number;
  spawnX: number;
  spawnY: number;
}

export const TILE_SIZE = 32;
// Damage tiles (fire) apply effectAmount HP-per-second in discrete ticks this far apart.
export const TILE_DAMAGE_INTERVAL_MS = 500;
// Knockback model: `overage = force − knockbackResistance`. overage ≤ 0 means the
// hit failed to clear the enemy's resistance → NO push and NO stun (heavy enemies
// shrug off weak hits). Above the threshold, push distance and stun both scale
// with overage. The stun (suppresses the enemy's chase for a moment) is what makes
// even a small clear read — otherwise the enemy immediately walks back into the push.
export const KNOCKBACK_SCALE = 6;            // px of push per unit of overage
export const KNOCKBACK_STUN_MS_PER_UNIT = 60; // ms of stun per unit of overage
export const KNOCKBACK_STUN_MAX_MS = 3000;    // cap so big hits don't stun-lock forever
export const SERVER_TICK_MS = 50;   // 20 Hz
export const MAX_CLIENTS = 4;
// Physics body geometry (simulated in server PhysicsWorld). Shared so the client
// debug overlay can draw the exact collision circle the server uses: a circle of
// ENTITY_RADIUS at the sprite's FEET (state.y + FOOT_OFFSET).
export const FOOT_OFFSET = 8;
export const ENTITY_RADIUS = 5;

// Enemy count per combat/maze room: base + floor(floorNum/2), then scaled by player count.
export const ENEMY_BASE_COUNT = 3;
export const ENEMY_FLOOR_BONUS_INTERVAL = 2; // +1 enemy per this many floors
export const ENEMY_PLAYER_SCALE = 0.25;      // +25% per extra player beyond 1
