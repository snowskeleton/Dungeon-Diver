import { Weapon, WeaponCategory, AttackFXType, RangedStyle } from "../base";

// Ranged: no melee hitbox. A bow controls fire rate + which ammo; the arrow carries the damage.
// Category base — the defaults every bow inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Bow extends Weapon {
  get category(): WeaponCategory { return "bow"; }
  get fxType(): AttackFXType { return "long-slash"; }
  get damage() { return 0; }
  get attackCooldownMs() { return 400; }
  get attackForce() { return 0; }
  get iconAngle() { return 0; }
  get ammoId(): string { return "arrow"; }
  get rangedStyle(): RangedStyle { return "held"; }
}
