import { Weapon, AMMO_REGISTRY } from "shared";

export interface StatLine {
  label: string;
  value: string;
}

// Human-readable stat lines for a weapon, reused by the store card and the
// inventory/acquire panels. Ranged weapons show their projectile's stats
// (damage/speed/pierce live on the ammo, not the weapon).
export function weaponStatLines(weapon: Weapon): StatLine[] {
  const cooldownS = weapon.attackCooldownMs / 1000;
  const rate = cooldownS > 0 ? (1 / cooldownS) : 0;

  if (weapon.isRanged && weapon.ammoId) {
    const ammo = AMMO_REGISTRY[weapon.ammoId];
    const dps = ammo ? ammo.damage * ammo.pierce * rate : 0;
    return [
      { label: "Damage", value: `${ammo?.damage ?? "?"}` },
      { label: "Fire rate", value: `${rate.toFixed(1)}/s` },
      { label: "Speed", value: `${ammo?.speed ?? "?"}` },
      { label: "Pierce", value: `${ammo?.pierce ?? "?"}` },
      { label: "Knockback", value: `${ammo?.knockback ?? "?"}` },
      { label: "DPS", value: dps.toFixed(1) },
    ];
  }

  return [
    { label: "Damage", value: `${weapon.damage}` },
    { label: "Cooldown", value: `${cooldownS.toFixed(2)}s` },
    { label: "DPS", value: (weapon.damage * rate).toFixed(1) },
    { label: "Knockback", value: `${weapon.attackForce}` },
  ];
}
