import { Weapon, WeaponCategory, AttackFXType, GetHurtbox, Override } from "../base";

// Ranged: no melee hitbox. Attacking conjures the staff's bolt projectile.
const noMelee: GetHurtbox = () => null;

// Staves are the Mage's ranged weapon: each one fires a bolt whose element is
// baked into that staff (see ammo/bolts). Like bows, a staff controls only the
// FIRE RATE (attackCooldownMs) and WHICH ammo — the bolt carries the damage,
// speed, knockback and pierce, so balance lives in ammo/bolts, not here.
//
// `fxType` is unused for ranged weapons (rangedStyle takes precedence in the
// client's Entity.configureWeaponVisuals), but the type requires a value; "nova"
// is kept because the AOE nova is the staff's planned active ability — the
// AoeSpec + aoeWeaponSpell + NovaFX path all remain wired for it.
const DEFAULTS = {
  category: "staff" as WeaponCategory,
  fxType: "nova" as AttackFXType,
  damage: 0,
  attackCooldownMs: 600,
  attackForce: 0,
  iconAngle: 0,
  ammoId: "magic-bolt",
  rangedStyle: "cast" as const,
};

export class Staff extends Weapon {
  constructor(o: Override) { super({ ...DEFAULTS, ...o }); }
}
