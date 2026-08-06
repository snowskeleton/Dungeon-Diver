import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Slash arc — mid-swing diagonal tilt.
// Category base — the defaults every mace inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Mace extends Weapon {
  get attackForce() { return 14; }
  get damage() { return 30; }
  get attackCooldownMs() { return 180; }
  get category(): WeaponCategory { return "mace"; }
  get fxType(): AttackFXType { return "slash"; }
  get iconAngle() { return -45; }
}
