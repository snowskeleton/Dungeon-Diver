// Interaction layers — a single vocabulary governing BOTH physical blocking
// (matter-js bodies) and combat hits (the overlap resolver). See docs/layers.md.
//
// WALL/PLAYER/ENEMY are the low three bits (1 / 2 / 4) because they double as
// matter-js collision categories; keep new layers above them.

export enum Layer {
  WALL          = 1 << 0, // 0x01
  PLAYER        = 1 << 1, // 0x02  player bodies (hurtable)
  ENEMY         = 1 << 2, // 0x04  enemy / boss bodies (hurtable)
  PLAYER_ATTACK = 1 << 3, // 0x08  player melee swings + player projectiles
  ENEMY_ATTACK  = 1 << 4, // 0x10  boss projectiles, AOE, telegraphed strikes
  PROP          = 1 << 5, // 0x20  bushes / destructibles / breakables
  PICKUP        = 1 << 6, // 0x40  dropped items, hearts
  HAZARD        = 1 << 7, // 0x80  lingering fire / poison ground tiles
}

// The three masks any interacting thing may carry. Solid bodies use layer +
// solidMask; hit sources (projectiles, swings, AOE) use layer + affects;
// projectiles add blockedBy for flight-stopping. Unused masks are 0.
export interface InteractionProfile {
  /** What this thing IS. Usually a single bit; feeds matter's `category`. */
  layer: number;
  /** What physically stops/separates this body. Symmetric; feeds matter's `mask`. */
  solidMask: number;
  /** What this thing's hitbox damages/triggers. Directional (Godot's mask). */
  affects: number;
  /** (Projectiles) which layers stop its flight. */
  blockedBy: number;
}

/** The directional combat rule: does a source's `affects` reach a target's `layer`? */
export function canAffect(sourceAffects: number, targetLayer: number): boolean {
  return (sourceAffects & targetLayer) !== 0;
}

// ── Default body profiles (solid entities) ────────────────────────────────────
// Every entity pair currently collides, so both player and enemy bodies block
// against WALL|PLAYER|ENEMY.
const ALL_SOLID = Layer.WALL | Layer.PLAYER | Layer.ENEMY;

export const PLAYER_BODY_PROFILE: InteractionProfile = {
  layer: Layer.PLAYER,
  solidMask: ALL_SOLID,
  affects: 0, // the body itself deals no damage; player attacks are separate sources
  blockedBy: 0,
};

export const ENEMY_BODY_PROFILE: InteractionProfile = {
  layer: Layer.ENEMY,
  solidMask: ALL_SOLID,
  affects: 0, // the body deals no damage; touch damage is Enemy.contactHitSource()
  blockedBy: 0,
};

/** A dead corpse still respects walls but neither shoves nor is shoved. */
export const CORPSE_SOLID_MASK = Layer.WALL;

// ── Attack affect-masks (directional) ─────────────────────────────────────────
// What each team's hit sources (melee swings, projectiles, AOE) are allowed to
// damage. Player attacks reach enemies and props but spare players; flip on
// Layer.PLAYER to enable friendly fire (see docs/layers.md — a one-bit change).
// Projectiles share these — a shot is just another player/enemy attack — and the
// PROJECTILE aliases below just read better at a projectile call site.
export const PLAYER_ATTACK_AFFECTS = Layer.ENEMY | Layer.PROP;
export const ENEMY_ATTACK_AFFECTS = Layer.PLAYER;
export const PLAYER_PROJECTILE_AFFECTS = PLAYER_ATTACK_AFFECTS;
export const ENEMY_PROJECTILE_AFFECTS = ENEMY_ATTACK_AFFECTS;
