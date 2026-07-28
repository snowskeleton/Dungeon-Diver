import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Straight thrust — tip points directly at the target.
// Category base — the defaults every dagger inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Dagger extends Weapon {
  get attackForce() { return 2; }
  get damage() { return 3; }
  get attackCooldownMs() { return 30; }
  get category(): WeaponCategory { return "dagger"; }
  get fxType(): AttackFXType { return "stab"; }
  get iconAngle() { return 0; }
}
