import { Weapon, WeaponCategory, AttackFXType, RangedStyle } from "../base";

// Staves are the Mage's ranged weapon: each fires a bolt whose element is baked into that staff (see ammo/bolts). A staff controls fire rate + which ammo; the bolt carries damage/speed/knockback/pierce, so balance lives in ammo/bolts. fxType is unused for ranged (rangedStyle wins client-side) but the type needs a value; "nova" stays because the AOE nova is the staff's planned active ability.
// Category base — the defaults every staff inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Staff extends Weapon {
  get category(): WeaponCategory { return "staff"; }
  get fxType(): AttackFXType { return "nova"; }
  get damage() { return 0; }
  get attackCooldownMs() { return 600; }
  get attackForce() { return 0; }
  get iconAngle() { return 0; }
  get ammoId(): string { return "magic-bolt"; }
  get rangedStyle(): RangedStyle { return "cast"; }
}
