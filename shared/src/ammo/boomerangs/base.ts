import { Ammo, AmmoOverride } from "../base";

// Boomerangs spin, pass over walls, never die on a hit (high pierce), and reverse
// at the midpoint of their lifetime to fly straight back. Damage/speed/lifetime
// vary per boomerang; returnsAtMs defaults to half the lifetime (symmetric
// out-and-back), and the long weapon cooldown sells the "wait for it" illusion.
const DEFAULTS = {
  category: "boomerangs" as const,
  pierce: 99,
  knockback: 3,
  hitRadiusForward: 12,
  hitRadiusSide: 12,
  spriteAngle: 0,
  spinDegPerSec: 720,
  ignoresWalls: true,
  lifetimeMs: 500,
  speed: 500,
  damage: 10,
};

export class Boomerang extends Ammo {
  constructor(o: AmmoOverride) {
    // speed and lifetimeMs fall back to DEFAULTS; returnsAtMs defaults to half
    // the effective lifetime.
    const lifetimeMs = o.lifetimeMs ?? DEFAULTS.lifetimeMs;
    super({ ...DEFAULTS, ...o, returnsAtMs: o.returnsAtMs ?? lifetimeMs / 2 });
  }
}
