import { Weapon, WeaponCategory, AttackFXType, Override } from "../base";

const DEFAULTS = {
  category: "dagger" as WeaponCategory,
  fxType: "stab" as AttackFXType,
  damage: 15,
  attackCooldownMs: 250,
  attackForce: 4,
  // Straight thrust — tip points directly at the target.
  iconAngle: 0,
};

export class Dagger extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
