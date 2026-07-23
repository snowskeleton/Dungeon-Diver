import { Ammo, AmmoCategory } from "../base";

// Boomerangs spin, pass over walls, never die on a hit (high pierce), and reverse
// at the midpoint of their lifetime to fly straight back. Damage/speed/lifetime
// vary per boomerang; returnsAtMs derives to half the lifetime (symmetric
// out-and-back) unless a concrete boomerang overrides it, and the long weapon
// cooldown sells the "wait for it" illusion. Category base.
export abstract class Boomerang extends Ammo {
  get category(): AmmoCategory { return "boomerangs"; }
  get pierce() { return 99; }
  get knockback() { return 3; }
  get hitRadiusForward() { return 12; }
  get hitRadiusSide() { return 12; }
  get spriteAngle() { return 0; }
  get spinDegPerSec() { return 720; }
  get ignoresWalls() { return true; }
  get lifetimeMs() { return 500; }
  get speed() { return 500; }
  get damage() { return 10; }
  // Reverse at the midpoint of the effective lifetime — reads the live getter so
  // a boomerang that overrides lifetimeMs gets a matching return point for free.
  get returnsAtMs() { return this.lifetimeMs / 2; }
}
