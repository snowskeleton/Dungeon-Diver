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
  override get namePrefix() { return "Sharp"; }
}

export class SavageMod extends WeaponMod {
  constructor(private readonly pct: number) { super(); }
  get label() { return `+${Math.round(this.pct * 100)}% damage`; }
  override get damagePct() { return this.pct; }
  override get namePrefix() { return "Savage"; }
  override get tint() { return 0xff6b6b; } // an angry red
}

export class SwiftMod extends WeaponMod {
  constructor(private readonly pct: number) { super(); }
  get label() { return `+${Math.round(this.pct * 100)}% attack speed`; }
  override get attackSpeedPct() { return this.pct; }
  override get namePrefix() { return "Swift"; }
}

export class HeavyMod extends WeaponMod {
  constructor(private readonly amount: number) { super(); }
  get label() { return `+${this.amount} knockback`; }
  override get attackForceFlat() { return this.amount; }
  override get namePrefix() { return "Heavy"; }
}

/**
 * A modifier that carries a real gameplay EFFECT (lifesteal) as well as its name and
 * colour — the exemplar that the composed-weapon plumbing carries abilities, not just
 * cosmetics. The effect itself is applied by the combat resolver (heal-on-hit); here
 * the mod only declares its fraction, name affix, and blood-red tint.
 */
export class VampiricMod extends WeaponMod {
  constructor(private readonly pct: number) { super(); }
  get label() { return `steals ${Math.round(this.pct * 100)}% of damage as health`; }
  override get lifestealPct() { return this.pct; }
  override get nameSuffix() { return "of Vampirism"; }
  override get tint() { return 0x8b0000; } // dark crimson
}

/**
 * Roll a modifier appropriate to `floor`. Magnitudes grow with depth so a floor-6
 * reward is meaningfully better than a floor-1 one without needing a separate
 * table of tiers — the scalar is just a function of depth.
 */
export function rollWeaponMod(floor: number): WeaponMod {
  const scale = 1 + (floor - 1) * 0.35;
  const pick = Math.floor(Math.random() * 5);
  switch (pick) {
    case 0: return new SharpMod(Math.max(1, Math.round(2 * scale)));
    case 1: return new SavageMod(round2(0.1 * scale));
    case 2: return new SwiftMod(round2(0.1 * scale));
    case 3: return new VampiricMod(round2(0.05 * scale));
    default: return new HeavyMod(Math.max(1, Math.round(2 * scale)));
  }
}

/** Keep rolled percentages to two decimals so stat panels don't show 0.13500001. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
