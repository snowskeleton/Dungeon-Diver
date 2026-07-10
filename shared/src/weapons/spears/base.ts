import { Weapon, WeaponCategory, AttackFXType, makeMeleeHurtbox, Override } from "../base";

const DEFAULTS = {
  category: "spear" as WeaponCategory,
  fxType: "long-stab" as AttackFXType,
  damage: 18,
  attackCooldownMs: 700,
  attackForce: 8,
  getHurtbox: makeMeleeHurtbox(60, 20),
  // Straight thrust — 0° offset so the tip points directly at the target.
  iconAngle: 0,
};

export class Spear extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
