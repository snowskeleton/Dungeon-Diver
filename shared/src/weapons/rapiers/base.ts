import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Straight thrust — tip points directly at the target.
// Category base — the defaults every rapier inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Rapier extends Weapon {
  get category(): WeaponCategory { return "rapier"; }
  get fxType(): AttackFXType { return "stab"; }
  get damage() { return 15; }
  get attackCooldownMs() { return 350; }
  get attackForce() { return 5; }
  get iconAngle() { return 0; }
}
