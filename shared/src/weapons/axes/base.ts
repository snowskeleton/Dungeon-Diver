import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Slash arc — same mid-swing diagonal tilt as swords.
// Category base — the defaults every axe inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Axe extends Weapon {
  get attackForce() { return 14; }
  get damage() { return 30; }
  get attackCooldownMs() { return 180; }
  get category(): WeaponCategory { return "axe"; }
  get fxType(): AttackFXType { return "slash"; }
  get iconAngle() { return -45; }
}
