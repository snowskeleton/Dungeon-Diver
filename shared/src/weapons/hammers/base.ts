import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Heavy overhead swing — same arc tilt as swords/axes.
// Category base — the defaults every hammer inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Hammer extends Weapon {
  get category(): WeaponCategory { return "hammer"; }
  get fxType(): AttackFXType { return "slash"; }
  get damage() { return 35; }
  get attackCooldownMs() { return 800; }
  get attackForce() { return 15; }
  get iconAngle() { return -45; }
}
