import { WeaponView, AmmoView } from "shared";

// The slot→view adapters live in shared (see weapons/views.ts) so the server can
// assert in its verify harness that a synced slot renders the numbers it computed.
export { viewFromSlot, viewFromTemplate } from "shared";

export interface StatLine {
  label: string;
  value: string;
  /** The raw number behind `value`, so a candidate weapon can be compared to the
   *  one you hold. Kept alongside the formatted string rather than re-parsed. */
  num: number;
  /** True when a bigger number is better for the player (damage, DPS, pierce…),
   *  false when smaller is better (cooldown). Comparison colours the arrow by
   *  THIS, not by the sign of the delta — a lower cooldown is an UPGRADE. */
  higherBetter: boolean;
}

/** How a candidate stat stacks up against the equipped weapon's same stat. */
export interface StatDelta {
  /** Whether the candidate's number is up or down from the equipped one. */
  dir: "up" | "down";
  /** Whether that move is an improvement — accounts for higher-is-better vs
   *  lower-is-better, so `dir: "down"` on cooldown is still `better: true`. */
  better: boolean;
  /** The size of the change, formatted like the stat's own value. */
  magnitude: string;
}

export interface ComparedStatLine extends StatLine {
  /** Present only when a comparison weapon was supplied AND this stat differs. */
  delta?: StatDelta;
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
      line("Damage", ammo ? round(ammo.damage) : "?", ammo?.damage ?? 0, true),
      line("Fire rate", `${rate.toFixed(1)}/s`, rate, true),
      line("Speed", `${ammo?.speed ?? "?"}`, ammo?.speed ?? 0, true),
      line("Pierce", `${ammo?.pierce ?? "?"}`, ammo?.pierce ?? 0, true),
      line("Knockback", ammo ? round(ammo.knockback) : "?", ammo?.knockback ?? 0, true),
      line("DPS", dps.toFixed(1), dps, true),
    ];
  }

  const dps = weapon.damage * rate;
  return [
    line("Damage", round(weapon.damage), weapon.damage, true),
    line("Cooldown", `${cooldownS.toFixed(2)}s`, cooldownS, false),
    line("DPS", dps.toFixed(1), dps, true),
    line("Knockback", round(weapon.attackForce), weapon.attackForce, true),
  ];
}

/** Stat lines for `weapon`, each annotated with how it compares to `compareTo`
 *  (the weapon the player currently holds). Stats are matched by label, so a
 *  ranged candidate against a melee weapon only compares the labels they share
 *  (Damage, DPS, Knockback) and leaves the rest un-annotated. With no comparison
 *  weapon — the player is empty-handed, e.g. the floor-1 supply room — this is
 *  just `weaponStatLines`. */
export function comparedStatLines(
  weapon: WeaponView,
  compareTo?: WeaponView | null,
): ComparedStatLine[] {
  const lines = weaponStatLines(weapon);
  if (!compareTo) return lines;
  const prev = new Map(weaponStatLines(compareTo).map((l) => [l.label, l] as const));
  return lines.map((cur) => {
    const before = prev.get(cur.label);
    if (!before || before.num === cur.num) return cur;
    const dir = cur.num > before.num ? "up" : "down";
    const better = cur.higherBetter ? dir === "up" : dir === "down";
    return {
      ...cur,
      delta: {
        dir,
        better,
        magnitude: round(Math.abs(cur.num - before.num)),
      },
    };
  });
}

/** One compared stat as an HTML fragment: the label/value plus, when it differs
 *  from the equipped weapon, a coloured arrow and delta. Green ▲ / red ▼ mean
 *  better / worse (not up / down) — a lower cooldown reads green. */
export function statLineHtml(l: ComparedStatLine): string {
  const base = `${l.label}: ${l.value}`;
  if (!l.delta) return base;
  const { dir, better, magnitude } = l.delta;
  const arrow = dir === "up" ? "▲" : "▼";
  const sign = dir === "up" ? "+" : "−";
  const color = better ? "#66dd88" : "#ff6b6b";
  return `${base} <span style="color:${color}">${arrow}${sign}${magnitude}</span>`;
}

/** Plain-text form for Phaser text objects (the store card / acquire panel), which
 *  can't colour a substring — the arrow glyph carries direction, the sign the size. */
export function statLineText(l: ComparedStatLine): string {
  const base = `${l.label}: ${l.value}`;
  if (!l.delta) return base;
  const arrow = l.delta.dir === "up" ? "▲" : "▼";
  const sign = l.delta.dir === "up" ? "+" : "−";
  return `${base} ${arrow}${sign}${l.delta.magnitude}`;
}

function line(
  label: string,
  value: string,
  num: number,
  higherBetter: boolean,
): StatLine {
  return {
    label,
    value,
    num,
    higherBetter,
  };
}

/** Modified stats are rarely whole numbers (a +15% roll on 12 damage is 13.8), so
 *  trim to one decimal and drop a trailing ".0" rather than showing 13.800000001. */
function round(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}
