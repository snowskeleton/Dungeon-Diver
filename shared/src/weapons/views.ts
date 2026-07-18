// Adapters that turn what's on the wire (or a bare template) into the WeaponView
// that display code reads.
//
// These live in shared rather than in the client UI for two reasons: the server
// can round-trip a slot through viewFromSlot in its verify harness and prove the
// client will see exactly the numbers the server computed, and the ranged
// "weapon damage adds to ammo damage" rule is written down in exactly one place
// instead of once per side.
//
// Separate module from instance.ts purely to avoid an import cycle: this needs
// WEAPON_REGISTRY, which lives in weapons/index.ts, which re-exports instance.ts.

import { AMMO_REGISTRY } from "../ammo";
import { Weapon } from "./base";
import { WeaponView, WeaponSlotView } from "./instance";
import { WEAPON_REGISTRY } from "./index";

/** A synced slot as a WeaponView: visuals from the template (every client already
 *  has all of them), stats from the wire (the wielder's resolved numbers, which
 *  the template cannot know). Null for an unknown weapon id — better a missing
 *  row than an invented weapon. */
export function viewFromSlot(slot: WeaponSlotView): WeaponView | null {
  const template = WEAPON_REGISTRY[slot.weaponId];
  if (!template) return null;
  return {
    ...templateFields(template),
    damage: slot.damage,
    attackCooldownMs: slot.attackCooldownMs,
    attackForce: slot.attackForce,
    ammo: template.isRanged
      ? {
          damage: slot.ammoDamage,
          speed: slot.ammoSpeed,
          pierce: slot.ammoPierce,
          knockback: slot.ammoKnockback,
        }
      : undefined,
  };
}

/** An unmodified template as a WeaponView — for a weapon nobody is wielding yet
 *  (a shop pedestal). */
export function viewFromTemplate(template: Weapon): WeaponView {
  const ammo = template.ammoId ? AMMO_REGISTRY[template.ammoId] : undefined;
  return {
    ...templateFields(template),
    damage: template.damage,
    attackCooldownMs: template.attackCooldownMs,
    attackForce: template.attackForce,
    ammo: ammo
      ? {
          // Mirrors the server's fold: a ranged weapon's damage adds to its ammo's.
          damage: ammo.damage + template.damage,
          speed: ammo.speed,
          pierce: ammo.pierce,
          knockback: ammo.knockback,
        }
      : undefined,
  };
}

/** The identity/visual half of a view — identical for a template and any instance
 *  of it, since only stats fold. */
function templateFields(template: Weapon) {
  return {
    id: template.id,
    name: template.name,
    fxType: template.fxType,
    iconPath: template.iconPath,
    iconAngle: template.iconAngle,
    rangedStyle: template.rangedStyle,
    ammoId: template.ammoId,
    isRanged: template.isRanged,
    getHurtbox: template.getHurtbox,
  };
}
