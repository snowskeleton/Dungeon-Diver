import { WeaponMod } from "shared";

// Concrete rolls that can land on a weapon instance. Same shape as Upgrade: one
// class per modifier, contributions as getters, collected in a plain array. The
// magnitude is a constructor argument so one class covers a whole tier of rolls
// ("+2 damage" and "+5 damage" are the same modifier, differently rolled) — that
// is a parameter, not a config table steering behaviour.

export class SharpMod extends WeaponMod {
  constructor(private readonly amount: number) { super(); }
  get label() { return `+${this.amount} damage`; }
  override get damageFlat() { return this.amount; }
}

export class SavageMod extends WeaponMod {
  constructor(private readonly pct: number) { super(); }
  get label() { return `+${Math.round(this.pct * 100)}% damage`; }
  override get damagePct() { return this.pct; }
}

export class SwiftMod extends WeaponMod {
  constructor(private readonly pct: number) { super(); }
  get label() { return `+${Math.round(this.pct * 100)}% attack speed`; }
  override get attackSpeedPct() { return this.pct; }
}

export class HeavyMod extends WeaponMod {
  constructor(private readonly amount: number) { super(); }
  get label() { return `+${this.amount} knockback`; }
  override get attackForceFlat() { return this.amount; }
}

/**
 * Roll a modifier appropriate to `floor`. Magnitudes grow with depth so a floor-6
 * reward is meaningfully better than a floor-1 one without needing a separate
 * table of tiers — the scalar is just a function of depth.
 */
export function rollWeaponMod(floor: number): WeaponMod {
  const scale = 1 + (floor - 1) * 0.35;
  const pick = Math.floor(Math.random() * 4);
  switch (pick) {
    case 0: return new SharpMod(Math.max(1, Math.round(2 * scale)));
    case 1: return new SavageMod(round2(0.1 * scale));
    case 2: return new SwiftMod(round2(0.1 * scale));
    default: return new HeavyMod(Math.max(1, Math.round(2 * scale)));
  }
}

/** Keep rolled percentages to two decimals so stat panels don't show 0.13500001. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
