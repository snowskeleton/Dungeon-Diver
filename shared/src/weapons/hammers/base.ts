import { Weapon, WeaponCategory, AttackFXType, Override } from "../base";

const DEFAULTS = {
  category: "hammer" as WeaponCategory,
  fxType: "slash" as AttackFXType,
  damage: 35,
  attackCooldownMs: 800,
  attackForce: 15,
  // Heavy overhead swing — same arc tilt as swords/axes.
  iconAngle: -45,
};

export class Hammer extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
