import { Weapon, WeaponCategory, AttackFXType, Override } from "../base";

const DEFAULTS = {
  category: "mace" as WeaponCategory,
  fxType: "slash" as AttackFXType,
  damage: 25,
  attackCooldownMs: 550,
  attackForce: 12,
  // Slash arc — mid-swing diagonal tilt.
  iconAngle: -45,
};

export class Mace extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
