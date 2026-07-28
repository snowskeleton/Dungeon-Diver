import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Straight thrust — tip points directly at the target.
// Category base — the defaults every rapier inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Rapier extends Weapon {
  get damage() { return 8; }
  get attackCooldownMs() { return 80; }
  get category(): WeaponCategory { return "rapier"; }
  get fxType(): AttackFXType { return "stab"; }
  // Same as the spears: the rapier art is drawn on the up-right 45° diagonal,
  // so it needs the same corrective tilt the blades use to rest upright.
  get iconAngle() { return -45; }
}
