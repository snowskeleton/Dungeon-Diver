import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Straight thrust — tip points directly at the target.
// Category base — the defaults every dagger inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Dagger extends Weapon {
  get category(): WeaponCategory { return "dagger"; }
  get fxType(): AttackFXType { return "stab"; }
  get damage() { return 15; }
  get attackCooldownMs() { return 250; }
  get attackForce() { return 4; }
  get iconAngle() { return 0; }
}
