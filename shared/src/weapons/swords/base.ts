import { Weapon, WeaponCategory, AttackFXType, makeMeleeHurtbox, Override } from "../base";

const DEFAULTS = {
  category: "sword" as WeaponCategory,
  fxType: "slash" as AttackFXType,
  damage: 20,
  attackCooldownMs: 500,
  attackForce: 7,
  getHurtbox: makeMeleeHurtbox(44, 40),
  // Slash sweeps in an arc — tilt -45° so the blade sits diagonally mid-swing
  // rather than fully extended toward the target.
  iconAngle: -45,
};

export class Sword extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
