import { Weapon, WeaponCategory, AttackFXType, makeMeleeHurtbox, Override } from "../base";

const DEFAULTS = {
  category: "staff" as WeaponCategory,
  fxType: "long-slash" as AttackFXType,
  damage: 30,
  attackCooldownMs: 600,
  attackForce: 10,
  getHurtbox: makeMeleeHurtbox(44, 40),
  // Aimed/swung toward the target — no offset needed.
  iconAngle: 0,
};

export class Staff extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
