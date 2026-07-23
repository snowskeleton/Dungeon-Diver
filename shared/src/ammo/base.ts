// Ammo = a projectile a ranged weapon (bow, crossbow) spawns when it fires.
// Defined separately from Weapon so all projectile behaviour lives in one place
// and a weapon just references an ammo id. Anything with a sprite can be ammo —
// arrows today, thrown swords/boomerangs tomorrow.
//
// Folder layout mirrors weapons/: ammo that shares a behaviour bundle is grouped
// under a category folder with its own base subclass (arrows/, boomerangs/);
// one-offs (throwing-knife, throwing-star) sit flat at the top level. Each ammo
// is <…>/<id>/index.ts (`export class … extends …`) + <id>/<id>.png.
// sync-to-client.js copies shared/src/ammo/**/*.png into client/public/sprites/
// ammo/ preserving that structure, so the derived spritePath resolves at runtime.

// Type-only (erased at runtime) so there's no import cycle with index.ts, which
// imports the concrete ammo classes and defines the AmmoId union.
import type { AmmoId } from "./index";

// Categories with a shared base subclass. One-offs pass no category and live flat.
export type AmmoCategory = "arrows" | "boomerangs" | "bolts";

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
  /**
   * If set, the client tints the sprite with this colour. Lets one piece of orb
   * art serve a family of elemental bolts (arcane violet, frost cyan, verdant
   * green) without a separate drawing for each. Drop the tint once an ammo gets
   * its own art. Omitted = the sprite renders at its drawn colours.
   */
  tint?: number;
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

// Ammo is object-oriented like Weapon and Enemy: an abstract base with getter
// defaults → a category base (Arrow/Bolt/Boomerang) that sets the shared
// behaviour bundle → a concrete ammo class that overrides only what differs. No
// DEFAULTS-object merge and no id→config table; the stats are compiler-checked
// getters. `implements AmmoConfig` keeps the read shape consumers already use.
//
// Every concrete ammo supplies `id` and `name`; a category base supplies
// `category` and the family's stat defaults. The generic getters below are
// functional placeholders so a brand-new ammo flies straight out of the box.
export abstract class Ammo implements AmmoConfig {
  /** Typed as AmmoId so a concrete class declaring `readonly id = "…"` is
   *  compiler-checked against the union. (Type-only import — no runtime cycle.) */
  abstract readonly id: AmmoId;
  abstract readonly name: string;

  get damage(): number { return 10; }
  get speed(): number { return 300; }
  get pierce(): number { return 1; }
  get knockback(): number { return 5; }
  get lifetimeMs(): number { return 1000; }
  get hitRadiusForward(): number { return 10; }
  get hitRadiusSide(): number { return 10; }
  get spriteAngle(): number { return 0; }
  get spinDegPerSec(): number { return 0; }
  get fixedAngle(): boolean { return false; }
  get ignoresWalls(): boolean { return false; }
  get returnsAtMs(): number | undefined { return undefined; }
  get tint(): number | undefined { return undefined; }
  /** Set by a category base (Arrow/Bolt/Boomerang); undefined = a flat one-off. */
  get category(): AmmoCategory | undefined { return undefined; }

  /** Client sprite path. Category ammo nests under its folder; one-offs are flat. */
  get spritePath(): string {
    const dir = this.category ? `${this.category}/` : "";
    return `/sprites/ammo/${dir}${this.id}/${this.id}.png`;
  }
}

/** A concrete ammo class: `new`-able with no args and carrying its id, so the
 *  registry builds from a plain array of classes — the ammo analogue of
 *  WeaponClass / EnemyClass. */
export type AmmoClass = { new (): Ammo };
