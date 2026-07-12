// Ammo = a projectile a ranged weapon (bow, crossbow) spawns when it fires.
// Defined separately from Weapon so all projectile behaviour lives in one place
// and a weapon just references an ammo id. Anything with a sprite can be ammo —
// arrows today, thrown swords/boomerangs tomorrow.
//
// Folder layout mirrors weapons/: ammo that shares a behaviour bundle is grouped
// under a category folder with its own base subclass (arrows/, boomerangs/);
// one-offs (throwing-knife, throwing-star) sit flat at the top level. Each ammo
// is <…>/<id>/index.ts (`export default new …({ ... })`) + <id>/<id>.png.
// sync-to-client.js copies shared/src/ammo/**/*.png into client/public/sprites/
// ammo/ preserving that structure, so the derived spritePath resolves at runtime.

// Categories with a shared base subclass. One-offs pass no category and live flat.
export type AmmoCategory = "arrows" | "boomerangs";

export interface AmmoConfig {
  id: string;
  name: string;
  /** Damage dealt to an enemy on hit. */
  damage: number;
  /** Travel speed in px/sec. */
  speed: number;
  /** How many enemies it can hit before despawning (1 = normal single-target). */
  pierce: number;
  /** Knockback force applied on hit (same units as weapon.attackForce). */
  knockback: number;
  /** Auto-despawn after this many ms in flight (also bounds range). */
  lifetimeMs: number;
  /**
   * Collision radius (px) along the travel direction ("length"/reach of the
   * hitbox) for the point-vs-enemy overlap test. Keep this at the visual length
   * so a shot doesn't reach an enemy sooner than it looks like it should. Equal
   * forward/side radii give a plain circle; unequal give an ellipse aligned to
   * travel direction.
   */
  hitRadiusForward: number;
  /**
   * Collision radius (px) perpendicular to travel ("width" of the hitbox).
   * Widen relative to hitRadiusForward to make a shot more forgiving
   * side-to-side without extending its reach.
   */
  hitRadiusSide: number;
  /** Client sprite path, served from client/public/sprites/ammo/. */
  spritePath: string;
  /** Category folder (arrows/boomerangs). Omitted for flat one-offs. */
  category?: AmmoCategory;
  /**
   * Rotation offset (degrees) baked into the sprite art: the angle the sprite
   * points at when unrotated. Arrow art points UP, so spriteAngle = -90 makes a
   * projectile travelling right (angle 0) render with its head pointing right.
   * Ignored when spinDegPerSec > 0 (spinning things aren't aimed).
   */
  spriteAngle: number;
  /**
   * If > 0, the sprite spins at this many degrees/sec instead of pointing along
   * its travel direction. Thrown weapons (stars, knives, boomerangs) spin; fired
   * arrows point. Defaults to 0.
   */
  spinDegPerSec?: number;
  /**
   * If true, the sprite ignores its travel direction and always renders at its
   * drawn orientation — for ground hazards that rise in place and radiate outward
   * (the Turtle Dragon's tremor shards jut up from the ground; they don't fly
   * point-first like an arrow). Overrides spriteAngle; mutually exclusive with
   * spinDegPerSec. Defaults to false.
   */
  fixedAngle?: boolean;
  /**
   * If set, the projectile reverses its velocity once it has been airborne this
   * many ms — a boomerang flies straight out, then straight back. Its hit list
   * is cleared on reversal so it can strike again on the return leg.
   */
  returnsAtMs?: number;
  /** If true, the projectile passes over wall tiles instead of despawning (boomerang). */
  ignoresWalls?: boolean;
}

/** Everything an ammo needs except the derived spritePath. */
export type AmmoOpts = Omit<AmmoConfig, "spritePath">;

export class Ammo implements AmmoConfig {
  readonly id: string;
  readonly name: string;
  readonly damage: number;
  readonly speed: number;
  readonly pierce: number;
  readonly knockback: number;
  readonly lifetimeMs: number;
  readonly hitRadiusForward: number;
  readonly hitRadiusSide: number;
  readonly spriteAngle: number;
  readonly spinDegPerSec: number;
  readonly fixedAngle: boolean;
  readonly returnsAtMs?: number;
  readonly ignoresWalls: boolean;
  readonly category?: AmmoCategory;
  readonly spritePath: string;

  constructor(o: AmmoOpts) {
    this.id = o.id;
    this.name = o.name;
    this.damage = o.damage;
    this.speed = o.speed;
    this.pierce = o.pierce;
    this.knockback = o.knockback;
    this.lifetimeMs = o.lifetimeMs;
    this.hitRadiusForward = o.hitRadiusForward;
    this.hitRadiusSide = o.hitRadiusSide;
    this.spriteAngle = o.spriteAngle;
    this.spinDegPerSec = o.spinDegPerSec ?? 0;
    this.fixedAngle = o.fixedAngle ?? false;
    this.returnsAtMs = o.returnsAtMs;
    this.ignoresWalls = o.ignoresWalls ?? false;
    this.category = o.category;
    // Category ammo nests under its folder (arrows/, boomerangs/); one-offs are flat.
    const dir = o.category ? `${o.category}/` : "";
    this.spritePath = `/sprites/ammo/${dir}${o.id}/${o.id}.png`;
  }
}

/** Partial override for category subclass constructors — only id/name/damage are
 *  required; everything else (speed, lifetime, behaviour) falls back to the
 *  category's DEFAULTS. Mirrors weapons' `Override`. */
export type AmmoOverride = Partial<AmmoOpts> & Pick<AmmoOpts, "id" | "name">;
