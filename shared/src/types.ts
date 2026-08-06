export type Facing = "up" | "down" | "left" | "right";

// The one facing rule, shared so client (local sprite) and server (authoritative)
// never drift. Facing follows the DOMINANT movement axis: whichever of |dx|/|dy|
// is larger decides horizontal-vs-vertical, so a stick pushed WNW faces left and
// one pushed NNW faces up — the split is the true 45° line, not a per-axis snap.
// On a near-tie (the diagonal band, ±FACING_HYSTERESIS) the previous facing is
// kept if it's still one of the two candidate directions, so holding a diagonal
// doesn't jitter between up and left; otherwise the horizontal candidate wins
// (which keeps keyboard diagonals, always exact ties, behaving as they always did:
// facing sideways rather than snapping vertical). No input at all keeps `prev`.
const FACING_HYSTERESIS = 0.35;
export function facingFromInput(dx: number, dy: number, prev: Facing): Facing {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-3 && ay < 1e-3) return prev;
  const horiz: Facing = dx > 0 ? "right" : "left";
  const vert: Facing = dy > 0 ? "down" : "up";
  if (ay < 1e-3) return horiz; // purely horizontal
  if (ax < 1e-3) return vert; // purely vertical
  const near = Math.min(ax, ay) / Math.max(ax, ay) >= 1 - FACING_HYSTERESIS;
  if (near) {
    if (prev === horiz || prev === vert) return prev; // hold through the diagonal band
    return ax >= ay ? horiz : vert;
  }
  return ax > ay ? horiz : vert;
}
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
  // Movement intent as a vector. Keyboard sends the eight quantized directions
  // (each component -1/0/1); a gamepad stick sends its analog tilt (|(dx,dy)| ≤ 1),
  // so the player moves in the exact stick direction. move() normalizes, so speed
  // is constant regardless of tilt magnitude — the analog part is direction only.
  dx: number;
  dy: number;
  attack: boolean;
  // The class movement ability (Charge / Blink / Dash / Vault). A discrete control
  // — the server edge-detects the press like `attack` and fires it along the
  // current movement heading (or facing when standing still). One field, not one
  // per class: the player's Character decides which ability the press triggers.
  ability: boolean;
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

// The run ends at this floor — there is no floor beyond it. Descending (stairs or
// a trap) never carries the party past it.
export const MAX_FLOORS = 10;

export type RoomType =
  | "combat"
  | "maze"
  | "boss"
  | "shop"
  | "shrine"
  | "wave"
  | "timed"
  | "dark"
  // The run's start room: a cover-free staging room, never populated with rabble.
  // On floor 1 it holds one weapon pedestal per player (LootDirector.spawnSupply).
  | "supply";

// Server → client messages
export interface FloorChangeMessage {
  seed: number;
  floor: number;
  spawnX: number;
  spawnY: number;
}

/** The server's answer to `requestBarrierState`: which barriers are standing on
 *  the CURRENT floor, by connection id.
 *
 *  The incremental lock/unlock broadcasts are deltas, and a client that wasn't
 *  listening when one fired has no way to recover it — which is every client at
 *  the moment a run starts (they are in the lobby) and again at every floor
 *  change (the pre-clear broadcast precedes `floor_change`, so it lands before
 *  the map it describes exists). Asking for the whole picture after building a
 *  map is what makes the overlays right regardless of ordering. */
export interface BarrierStateMessage {
  parentStanding: string[];
  childStanding: string[];
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
// The authoritative simulation runs at a fixed 60 Hz. SERVER_TICK_MS is the fixed
// sim dt every tick integrates over (a non-integer 16.667ms); the GameRoom drives its
// tick from a wall-clock accumulator so a rounded setInterval cadence can't drift
// sim-time. 60 Hz matches the client's render/prediction rate, so client-side
// prediction and the server integrate the SAME dt — the core fix for guest
// rubber-banding (a 20 Hz server vs 60 fps client could never agree in open space).
export const SERVER_TICK_HZ = 60;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_HZ;   // ≈16.667ms
// The host streams state deltas to guests at a LOWER rate than it simulates — guests
// interpolate a ~200ms buffer, so 30 Hz snapshots look identical while keeping guest
// downstream bandwidth from tripling with the sim rate. Client→host INPUT still flows
// at the full sim rate (tiny, and required for exact prediction replay parity).
export const NET_SNAPSHOT_MS = 1000 / 30;   // ≈33.3ms (30 Hz)
export const MAX_CLIENTS = 4;
// How many weapons a player may carry at once (27 July playtest — a run used to
// end with 20). At the cap, taking a new weapon drops the one currently in hand
// onto the floor, where anyone can pick it back up. Two lets a player keep a
// melee + ranged pair without turning the inventory into a stockpile.
export const MAX_WEAPONS = 2;
// Melee combo grace window (ms). A swing continues the combo (first → reverse →
// finisher) only if the next swing lands within the weapon's cooldown PLUS this
// grace; wait longer and the chain resets to the first swing. The default here is
// deliberately short — the client surfaces it as a universal, tunable Option
// (gameOptions.comboWindowMs) that each player sends to the server on join, so
// this is only the fallback when no preference has been received.
export const DEFAULT_COMBO_WINDOW_MS = 600;
// Melee attacks are DEFERRED: a press holds the swing's wind-up pose and fires on
// release. Release before this hold threshold → a regular swing (advances the
// combo); hold at least this long → a heavy "hard" swing. Like the combo window,
// this is surfaced as a universal, tunable Option (gameOptions.chargeHoldMs) the
// client sends to the server; this is the fallback default.
export const DEFAULT_CHARGE_HOLD_MS = 600;
// Attack input buffer (ms). A press that can't fire yet — the weapon is still mid-
// swing or on cooldown — is REMEMBERED for this long and fires the instant the
// weapon frees up, so a slightly-early second tap isn't dropped. This is the
// "carry forward a keypress that wasn't valid on first send" window. Surfaced as a
// tunable Option (gameOptions.attackBufferMs) the client sends; this is the
// fallback default. 0 disables buffering (strictly press-when-ready).
export const DEFAULT_ATTACK_BUFFER_MS = 150;
// When a deferred enemy is revealed (a player walks into its room) it doesn't act
// immediately: it emerges from its dust puff over this long, holding in place and
// dealing no contact damage, then starts moving. Shared so the client can pace the
// spawn smoke to the same window.
export const ENEMY_SPAWN_EMERGE_MS = 1000;
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

// ── Class movement abilities (Charge / Blink / Dash / Vault) ──────────────────
// Tunables for the per-class movement ability. Distances in px, times in ms,
// speeds in px/sec. Each class's ability is assembled from these in the server's
// movementSpellFor() (see server/src/spells/movement.ts). Kept here beside the
// other feel constants so the whole movement kit is tuned in one place.
//
// Charge (Knight): a committed offensive rush — plows through enemies dealing
// contact damage + knockback, stopped by walls/barriers.
export const CHARGE_SPEED = 340;
export const CHARGE_DURATION_MS = 230;
export const CHARGE_COOLDOWN_MS = 4000;
export const CHARGE_DAMAGE = 12;
export const CHARGE_KNOCKBACK = 14;
export const CHARGE_HIT_RADIUS = 20;
// Blink (Mage): an instant short-range teleport, clamped to the furthest walkable
// point before any wall/barrier along the heading.
export const BLINK_DISTANCE = 110;
export const BLINK_COOLDOWN_MS = 3500;
// The teleport is not instant: the Mage vanishes, is gone (invisible + untargetable)
// for this brief gap, then reappears at the destination. Reads as a real blink
// rather than a snap. The player is frozen at the origin during the gap; the jump
// itself happens the instant it ends.
export const BLINK_HIDDEN_MS = 240;
// Dash (Rogue): a short, spammable dodge — invulnerable for the whole (brief)
// active window and phasing through enemy bodies. Pure mobility, no damage.
export const DASH_SPEED = 400;
export const DASH_DURATION_MS = 165;
export const DASH_COOLDOWN_MS = 2200;
// Vault (Ranger): an arced leap — rises to AIR elevation (dodging ground attacks
// and fire, but not flyers), phasing over cover blocks and enemies, landing on a
// walkable tile. Longer and higher than the Dash; a repositioning tool.
export const VAULT_SPEED = 235;
export const VAULT_DURATION_MS = 360;
export const VAULT_COOLDOWN_MS = 5000;
export const VAULT_PEAK_HEIGHT = 34;

// Enemy count per combat/maze room: base + floor(floorNum/2), then scaled by player count.
export const ENEMY_BASE_COUNT = 7;
export const ENEMY_FLOOR_BONUS_INTERVAL = 2; // +1 enemy per this many floors
export const ENEMY_PLAYER_SCALE = 0.25;      // +25% per extra player beyond 1

// Enemy (and boss) max-HP multiplier by party size: 1 + ENEMY_HP_PLAYER_SCALE ×
// (partySize − 1). So solo ×1.0, duo ×1.5, trio ×2.0, four-player ×2.5. Applied
// once at spawn in SpawnDirector — the run is locked once started, so party size
// is fixed and no live re-scaling is needed.
export const ENEMY_HP_PLAYER_SCALE = 0.5;
export function partyHpMultiplier(partySize: number): number {
  return 1 + ENEMY_HP_PLAYER_SCALE * (Math.max(1, partySize) - 1);
}
