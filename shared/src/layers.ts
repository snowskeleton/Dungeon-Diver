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
  BARRIER_EXIT  = 1 << 8, // 0x100 a locked room's ONE-WAY exit barrier (see below)
  COVER         = 1 << 9, // 0x200 a room's INTERIOR designer-placed cover block —
                          //       a wall for ground movement, but flown OVER by
                          //       airborne enemies (see AIRBORNE_ENEMY_BODY_PROFILE)
}

// One-way barriers (playtest G1). A locked room's exit barrier must let a
// latecomer walk IN while stopping anyone from walking OUT — which a solid body
// cannot express, since matter collision is symmetric. So the barrier gets its
// own category and only players who are COMMITTED (already inside the room's
// interior) carry the bit in their mask. Walking in is free; once you're in, the
// bit goes on and the same body becomes a wall behind you.
//
// Commitment flips on the room INTERIOR, which is inset a tile past the doorway
// the barrier sits in — so a player can never gain the bit while overlapping the
// body and get squeezed out to an arbitrary side.
export const PLAYER_COMMITTED_SOLID_MASK = Layer.WALL | Layer.COVER | Layer.PLAYER | Layer.ENEMY | Layer.BARRIER_EXIT;

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
// Every ground entity pair currently collides, so both player and (ground) enemy
// bodies block against WALL|COVER|PLAYER|ENEMY. COVER is the interior cover blocks
// — ground movement treats them exactly like walls; only airborne enemies drop the
// bit (see AIRBORNE_ENEMY_BODY_PROFILE) so they fly over cover.
const ALL_SOLID = Layer.WALL | Layer.COVER | Layer.PLAYER | Layer.ENEMY;

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

/** An airborne enemy (bat/floater/flying boss — any Enemy with cruiseHeight > 0)
 *  flies OVER interior cover blocks: same as the ground profile but with COVER
 *  dropped from the solid mask, so it still collides with structural walls, the
 *  room perimeter, players, and other enemies. Height itself stays purely visual;
 *  this only changes which walls stop it. */
export const AIRBORNE_ENEMY_BODY_PROFILE: InteractionProfile = {
  layer: Layer.ENEMY,
  solidMask: Layer.WALL | Layer.PLAYER | Layer.ENEMY,
  affects: 0,
  blockedBy: 0,
};

/** A dead corpse still respects walls (and cover) but neither shoves nor is shoved. */
export const CORPSE_SOLID_MASK = Layer.WALL | Layer.COVER;

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
