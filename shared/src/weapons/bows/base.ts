import { Weapon, WeaponCategory, AttackFXType, GetHurtbox, Override } from "../base";

// Ranged: no melee hitbox. Attacking spawns the weapon's ammo projectile.
const noMelee: GetHurtbox = () => null;

const DEFAULTS = {
  category: "bow" as WeaponCategory,
  fxType: "long-slash" as AttackFXType, // unused for ranged; type requires a value
  damage: 0,
  attackCooldownMs: 400,
  attackForce: 0,
  iconAngle: 0,
  ammoId: "arrow",
  rangedStyle: "held" as const,
};

export class Bow extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
