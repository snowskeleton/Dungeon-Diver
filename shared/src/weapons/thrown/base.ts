import { Weapon, WeaponCategory, AttackFXType, RangedStyle } from "../base";

// Thrown weapons are ranged: attacking spawns a projectile (the weapon leaves the hand). rangedStyle "thrown" means no in-hand sprite. Each thrown weapon sets its own ammoId.
// Category base — the defaults every thrown inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Thrown extends Weapon {
  get category(): WeaponCategory { return "thrown"; }
  get fxType(): AttackFXType { return "long-slash"; }
  get damage() { return 0; }
  get attackCooldownMs() { return 250; }
  get attackForce() { return 0; }
  get iconAngle() { return 0; }
  get rangedStyle(): RangedStyle { return "thrown"; }
}
