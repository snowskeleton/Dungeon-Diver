import { Weapon, WeaponCategory, AttackFXType, GetHurtbox, Override } from "../base";

// Ranged: no melee hitbox. Attacking spawns the weapon's ammo projectile.
const noMelee: GetHurtbox = () => null;

const DEFAULTS = {
  category: "crossbow" as WeaponCategory,
  fxType: "long-slash" as AttackFXType, // unused for ranged; type requires a value
  damage: 0,
  attackCooldownMs: 600,
  attackForce: 0,
  getHurtbox: noMelee,
  iconAngle: 0,
  ammoId: "steel-arrow",
  rangedStyle: "held" as const,
};

export class Crossbow extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
