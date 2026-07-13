import { Weapon, WeaponCategory, AttackFXType, makeMeleeHurtbox, Override } from "../base";

const DEFAULTS = {
  category: "staff" as WeaponCategory,
  fxType: "long-slash" as AttackFXType,
  damage: 30,
  attackCooldownMs: 600,
  attackForce: 10,
  // Staves are the Mage's AOE weapon: a brief wind-up, then a damaging nova around
  // the caster (the server builds a wind-up+AOE Spell from this — see weaponSpell).
  // getHurtbox stays as a harmless fallback; the AOE path is what actually fires.
  getHurtbox: makeMeleeHurtbox(44, 40),
  aoe: { radius: 76, windUpMs: 260, blastMs: 130 },
  // Aimed/swung toward the target — no offset needed.
  iconAngle: 0,
};

export class Staff extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
