import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Slash arc — mid-swing diagonal tilt.
// Category base — the defaults every mace inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Mace extends Weapon {
  get category(): WeaponCategory { return "mace"; }
  get fxType(): AttackFXType { return "slash"; }
  get damage() { return 25; }
  get attackCooldownMs() { return 550; }
  get attackForce() { return 12; }
  get iconAngle() { return -45; }
}
