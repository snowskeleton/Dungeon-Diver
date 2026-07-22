import { Weapon, WeaponCategory, AttackFXType, RangedStyle } from "../base";

// Ranged: no melee hitbox. Fires the weapon's ammo projectile.
// Category base — the defaults every crossbow inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Crossbow extends Weapon {
  get category(): WeaponCategory { return "crossbow"; }
  get fxType(): AttackFXType { return "long-slash"; }
  get damage() { return 0; }
  get attackCooldownMs() { return 600; }
  get attackForce() { return 0; }
  get iconAngle() { return 0; }
  get ammoId(): string { return "steel-arrow"; }
  get rangedStyle(): RangedStyle { return "held"; }
}
