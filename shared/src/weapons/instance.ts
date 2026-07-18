// A WIELDED weapon, as opposed to a weapon TEMPLATE.
//
// WEAPON_REGISTRY holds one immutable `Weapon` per id — the template. Those are
// shared by every player and every client, and nothing ever mutates them. A
// WeaponInstance is what a player actually carries: a reference to a template plus
// its own list of modifiers, so two players can hold "a broadsword" and have them
// be genuinely different weapons ("this one rolled +2 damage").
//
// Identity, visuals, and geometry delegate straight through to the template —
// only the numeric stats fold. That keeps the 52 template modules untouched and
// means a rolled weapon still draws with the same icon and swings the same arc.

import { Weapon, AttackFXType, RangedStyle, GetHurtbox } from "./base";

/** Attack-cooldown floor (ms). Attack-speed modifiers divide the cooldown, so
 *  without a floor a big enough stack would collapse the swing window to nothing
 *  and the melee spell's active phase (which IS the swing) would never land. */
export const MIN_ATTACK_COOLDOWN_MS = 50;

/** The projectile stats a ranged weapon's shot ends up with, after the wielder's
 *  modifiers are folded in. Kept separate from the full AmmoConfig because this is
 *  the part that varies per instance — everything else about a bolt is template
 *  data the client already has. */
export interface AmmoView {
  damage: number;
  speed: number;
  pierce: number;
  knockback: number;
}

/**
 * The wire shape of a wielded weapon: resolved stats, not the modifiers that
 * produced them. Declared here rather than in the server's schema module so the
 * client can consume a synced slot without importing server code — the schema
 * class satisfies this structurally, and the compiler checks that it still does.
 */
export interface WeaponSlotView {
  uid: string;
  weaponId: string;
  damage: number;
  attackCooldownMs: number;
  attackForce: number;
  ammoDamage: number;
  ammoSpeed: number;
  ammoPierce: number;
  ammoKnockback: number;
  /** Typed loosely (iterable + length rather than string[]) because on the wire
   *  this is a Colyseus ArraySchema, which is array-LIKE but not an Array. */
  modLabels: Iterable<string> & { length: number };
}

/**
 * The read surface anything displaying or swinging a weapon needs. Both a `Weapon`
 * template and a `WeaponInstance` satisfy it, so UI code can take either — the
 * client renders synced instances, the debug overlay uses templates.
 */
export interface WeaponView {
  readonly id: string;
  readonly name: string;
  readonly fxType: AttackFXType;
  readonly iconPath: string;
  readonly iconAngle: number;
  readonly rangedStyle?: RangedStyle;
  readonly ammoId?: string;
  readonly isRanged: boolean;
  readonly damage: number;
  readonly attackCooldownMs: number;
  readonly attackForce: number;
  readonly getHurtbox: GetHurtbox;
  /** Resolved projectile stats for a ranged weapon; undefined for melee. */
  readonly ammo?: AmmoView;
}

/**
 * One modification applied to a specific weapon — a roll on spawn ("+2 damage"),
 * or an upgrade the player later attaches to that weapon.
 *
 * Every contribution defaults to zero so a subclass overrides only the one or two
 * getters it actually cares about, and the compiler catches a typo'd override.
 * Percent values are fractions: 0.1 = +10%.
 */
export abstract class WeaponMod {
  /** Display string for the stat panel — e.g. "+2 damage". Never parsed. */
  abstract readonly label: string;

  get damageFlat(): number { return 0; }
  get damagePct(): number { return 0; }
  get attackForceFlat(): number { return 0; }
  get attackForcePct(): number { return 0; }
  /** Percent ATTACK SPEED, not cooldown — see resolveCooldown for why. */
  get attackSpeedPct(): number { return 0; }
}

/** (base + Σflat) × (1 + Σpct). Flats all land before any percent, and percents
 *  sum rather than compound, so the result never depends on the order mods were
 *  acquired in — which matters when the player can't choose their drop order. */
export function foldStat(base: number, flat: number, pct: number): number {
  return (base + flat) * (1 + pct);
}

/** Cooldown folds as attack SPEED rather than as a percent reduction: a −100%
 *  cooldown would be a divide-by-zero singularity, whereas +100% attack speed
 *  simply halves it and can never reach zero. Floored regardless. */
export function resolveCooldown(base: number, speedPct: number): number {
  return Math.max(MIN_ATTACK_COOLDOWN_MS, base / (1 + speedPct));
}

export class WeaponInstance implements WeaponView {
  readonly uid: string;
  readonly template: Weapon;
  private readonly mods: WeaponMod[];

  constructor(
    template: Weapon,
    uid: string,
    mods: WeaponMod[] = [],
  ) {
    this.template = template;
    this.uid = uid;
    this.mods = mods;
  }

  // ── Identity, visuals, geometry: pure delegation, nothing to fold ────────────
  get id(): string { return this.template.id; }
  get name(): string { return this.template.name; }
  get fxType(): AttackFXType { return this.template.fxType; }
  get iconPath(): string { return this.template.iconPath; }
  get iconAngle(): number { return this.template.iconAngle; }
  get rangedStyle(): RangedStyle | undefined { return this.template.rangedStyle; }
  get ammoId(): string | undefined { return this.template.ammoId; }
  get aoe() { return this.template.aoe; }
  get isRanged(): boolean { return this.template.isRanged; }
  get isAoe(): boolean { return this.template.isAoe; }
  get getHurtbox(): GetHurtbox { return this.template.getHurtbox; }

  // ── Folded stats ────────────────────────────────────────────────────────────
  get damage(): number {
    return foldStat(this.template.damage, this.sum(m => m.damageFlat), this.sum(m => m.damagePct));
  }

  get attackForce(): number {
    return foldStat(
      this.template.attackForce,
      this.sum(m => m.attackForceFlat),
      this.sum(m => m.attackForcePct),
    );
  }

  get attackCooldownMs(): number {
    return resolveCooldown(this.template.attackCooldownMs, this.sum(m => m.attackSpeedPct));
  }

  /** Display strings for every mod on this instance, in the order applied. */
  get modLabels(): string[] {
    return this.mods.map(m => m.label);
  }

  /** True when this weapon differs from its template at all. */
  get isModified(): boolean {
    return this.mods.length > 0;
  }

  private sum(pick: (m: WeaponMod) => number): number {
    return this.mods.reduce((acc, m) => acc + pick(m), 0);
  }
}
