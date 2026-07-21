import { Weapon, WeaponCategory, AttackFXType, Override } from "../base";

const DEFAULTS = {
  category: "axe" as WeaponCategory,
  fxType: "slash" as AttackFXType,
  damage: 22,
  attackCooldownMs: 600,
  attackForce: 9,
  // Slash arc — same mid-swing diagonal tilt as swords.
  iconAngle: -45,
};

export class Axe extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
