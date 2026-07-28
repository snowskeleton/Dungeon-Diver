import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Slash sweeps in an arc — tilt -45° so the blade sits diagonally mid-swing.
// Category base — the defaults every sword inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Sword extends Weapon {
  get category(): WeaponCategory { return "sword"; }
  get fxType(): AttackFXType { return "slash"; }
  get iconAngle() { return -45; }
}
