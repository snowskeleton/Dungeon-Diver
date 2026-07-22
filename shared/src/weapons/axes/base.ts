import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Slash arc — same mid-swing diagonal tilt as swords.
// Category base — the defaults every axe inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Axe extends Weapon {
  get category(): WeaponCategory { return "axe"; }
  get fxType(): AttackFXType { return "slash"; }
  get damage() { return 22; }
  get attackCooldownMs() { return 600; }
  get attackForce() { return 9; }
  get iconAngle() { return -45; }
}
