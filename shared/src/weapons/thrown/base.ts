import { Weapon, WeaponCategory, AttackFXType, GetHurtbox, Override } from "../base";

// Thrown weapons are ranged: attacking spawns a projectile (the weapon leaves
// the hand). No melee hitbox, and rangedStyle "thrown" means the client shows no
// in-hand sprite — the flying projectile is the whole visual. Each thrown weapon
// points its ammoId at a matching projectile whose art is the same sprite.
const noMelee: GetHurtbox = () => null;

const DEFAULTS = {
  category: "thrown" as WeaponCategory,
  fxType: "long-slash" as AttackFXType, // unused for ranged; type requires a value
  damage: 0,
  attackCooldownMs: 250,
  attackForce: 0,
  getHurtbox: noMelee,
  iconAngle: 0,
  rangedStyle: "thrown" as const,
};

export class Thrown extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
