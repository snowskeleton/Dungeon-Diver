import { WeaponView, AmmoView } from "shared";

// The slot→view adapters live in shared (see weapons/views.ts) so the server can
// assert in its verify harness that a synced slot renders the numbers it computed.
export { viewFromSlot, viewFromTemplate } from "shared";

export interface StatLine {
  label: string;
  value: string;
}

// Human-readable stat lines for a weapon, reused by the store card and the
// inventory/acquire panels. Takes a WeaponView so it serves both a plain template
// and a wielded instance whose stats have been modified — the numbers are read off
// the view rather than looked up, so a rolled weapon displays its real values.
export function weaponStatLines(weapon: WeaponView): StatLine[] {
  const cooldownS = weapon.attackCooldownMs / 1000;
  const rate = cooldownS > 0 ? (1 / cooldownS) : 0;

  if (weapon.isRanged) {
    const ammo: AmmoView | undefined = weapon.ammo;
    const dps = ammo ? ammo.damage * ammo.pierce * rate : 0;
    return [
      { label: "Damage", value: `${ammo ? round(ammo.damage) : "?"}` },
      { label: "Fire rate", value: `${rate.toFixed(1)}/s` },
      { label: "Speed", value: `${ammo?.speed ?? "?"}` },
      { label: "Pierce", value: `${ammo?.pierce ?? "?"}` },
      { label: "Knockback", value: `${ammo ? round(ammo.knockback) : "?"}` },
      { label: "DPS", value: dps.toFixed(1) },
    ];
  }

  return [
    { label: "Damage", value: `${round(weapon.damage)}` },
    { label: "Cooldown", value: `${cooldownS.toFixed(2)}s` },
    { label: "DPS", value: (weapon.damage * rate).toFixed(1) },
    { label: "Knockback", value: `${round(weapon.attackForce)}` },
  ];
}

/** Modified stats are rarely whole numbers (a +15% roll on 12 damage is 13.8), so
 *  trim to one decimal and drop a trailing ".0" rather than showing 13.800000001. */
function round(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}
