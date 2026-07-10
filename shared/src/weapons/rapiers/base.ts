import { Weapon, WeaponCategory, AttackFXType, makeMeleeHurtbox, Override } from "../base";

const DEFAULTS = {
  category: "rapier" as WeaponCategory,
  fxType: "stab" as AttackFXType,
  damage: 15,
  attackCooldownMs: 350,
  attackForce: 5,
  getHurtbox: makeMeleeHurtbox(50, 18),
  // Straight thrust — tip points directly at the target.
  iconAngle: 0,
};

export class Rapier extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
