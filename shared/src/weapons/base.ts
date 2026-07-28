import { Facing } from "../types";
import { fxHurtboxAt } from "./hurtbox";
// Type-only (erased at runtime) so there's no import cycle with index.ts, which
// imports the concrete weapon classes and defines the WeaponId union.
import type { WeaponId } from "./index";

export type AttackFXType = "slash" | "long-slash" | "stab" | "long-stab" | "nova";

/** The directional swing/stab strips — the FX types that are an actual 4-frame
 *  sheet, and so the ones a melee hurtbox can be measured from. "nova" is the
 *  odd one out: a procedural expanding blast with no strip art. */
export type StripFXType = Exclude<AttackFXType, "nova">;

export function isStripFx(fx: AttackFXType): fx is StripFXType {
  return fx !== "nova";
}
export type WeaponCategory = "sword" | "axe" | "spear" | "rapier" | "mace" | "dagger" | "hammer" | "bow" | "crossbow" | "staff" | "thrown";

/** How a ranged weapon renders its attack client-side (see Entity.setupCharacter).
 *  "held"  — a 2-frame draw sheet played beside the player (bows, crossbows).
 *  "thrown" — nothing stays in hand; the flying projectile is the whole visual.
 *  "cast"  — the weapon icon stays in hand and pulses/raises on cast (staves),
 *            reusing the single icon PNG rather than needing a draw sheet. */
export type RangedStyle = "held" | "thrown" | "cast";

export interface RectHitRegion  { shape: "rect";   x: number; y: number; w: number; h: number }
export interface CircleHitRegion { shape: "circle"; cx: number; cy: number; r: number }
export type HitRegion = RectHitRegion | CircleHitRegion;
/** A weapon's melee region at a given point in its swing. `swingMs` is elapsed
 *  time into the ATTACK ANIMATION (not the weapon's cooldown) — the hurtbox
 *  follows the art frame by frame. Returns null while no blade is drawn. */
export type GetHurtbox = (px: number, py: number, facing: Facing, swingMs: number) => HitRegion | null;

/** One swing of a melee weapon's combo. A consecutive-swing chain steps through
 *  these in order (wrapping): the first is a plain swing, the second the same arc
 *  mirrored (the "reverse"), the third a wider finisher. `damageMult`/`knockbackMult`
 *  scale that swing's blow, so a weapon (or category) can make its finisher hit
 *  harder without touching a damage number in any spell. See Weapon.comboSwings. */
export interface ComboSwing {
  /** Which FX strip this swing draws — and so which measured hurtbox it uses. */
  fxType: StripFXType;
  /** Flip the arc across the facing axis, so a chained swing reads as a backswing. */
  mirrored: boolean;
  damageMult: number;
  knockbackMult: number;
}

/** The wider "long" strip for a base strip type — the combo finisher's reach.
 *  A strip that is already long stays itself. */
export function longFxVariant(fx: StripFXType): StripFXType {
  switch (fx) {
    case "slash":      return "long-slash";
    case "stab":       return "long-stab";
    case "long-slash": return "long-slash";
    case "long-stab":  return "long-stab";
  }
}

/** An area-of-effect blast a weapon casts (the Mage's staff): after a brief
 *  wind-up the caster erupts a damaging circle around itself for `blastMs`. Marks
 *  the weapon as an AOE caster — the server builds a wind-up+AOE Spell from it
 *  (see server weaponSpell), instead of a melee swing or a ranged shot. */
export interface AoeSpec {
  /** Blast radius (px) centred on the caster. */
  radius: number;
  /** Telegraph time (ms) before the blast lands. */
  windUpMs: number;
  /** How long (ms) the blast hitbox stays active. */
  blastMs: number;
}

const CATEGORY_DIRS: Record<WeaponCategory, string> = {
  sword: "swords", axe: "axes", spear: "spears", rapier: "rapiers",
  mace: "maces", dagger: "daggers", hammer: "hammers",
  bow: "bows", crossbow: "crossbows", staff: "staves", thrown: "thrown",
};

// A weapon TEMPLATE. Like enemies, weapons are object-oriented: one class per
// weapon (server/shared has no id→config table). Stats are getters resolved up
// a three-level chain — Weapon (generic defaults) → a category base such as
// `Sword` (the category's defaults) → the concrete weapon (only what differs) —
// exactly mirroring Enemy → DirectionalEnemy → a leaf enemy. A weapon currently
// carries no behaviour beyond its numbers (the swing/shot/AOE is derived from
// its config by the server's weaponSpell), but being a real class means a
// specific weapon can grow a bespoke method later without reshaping everything.
//
// Every concrete weapon supplies `id` and `name`; a category base supplies
// `category` (and usually fxType/iconAngle and the category's damage/cooldown).
// The generic getters below are functional placeholders so a new weapon is a
// working slash out of the box.
export abstract class Weapon {
  /** The weapon's id. Typed as WeaponId so a concrete class declaring
   *  `readonly id = "…"` is compiler-checked against the union — a typo can't
   *  slip through. (Type-only import, so there's no runtime cycle with index.) */
  abstract readonly id: WeaponId;
  abstract readonly name: string;
  /** Set by the category base (Sword/Bow/Staff/…), never per weapon. */
  abstract get category(): WeaponCategory;

  get fxType(): AttackFXType { return "slash"; }
  get damage(): number { return 10; }
  get attackCooldownMs(): number { return 200; }
  get attackForce(): number { return 5; }
  /**
   * Rotation offset (degrees) applied to the weapon icon on top of the base
   * facing rotation. The base rotation points the icon toward the attack target
   * (right=90°, down=180°, left=270°, up=0°) because icons are drawn pointing UP.
   * Use this to tilt the icon for the weapon's natural hold angle — e.g. -45 on a
   * slashing weapon so the blade sits diagonally mid-swing rather than fully extended.
   */
  get iconAngle(): number { return 0; }

  // ── Melee combo (three-hit chain) ────────────────────────────────────────────
  // Per-swing multipliers, as plain numeric getters so the weapon-balance tool
  // can edit them and a category base or a single weapon can selectively buff one
  // swing. Defaults: the first two swings are neutral; the finisher hits +25%.
  // Ranged/AOE weapons carry these too but never combo, so they're simply unused.
  get combo1DamageMult(): number { return 1; }
  get combo2DamageMult(): number { return 1; }
  get combo3DamageMult(): number { return 1.25; }
  get combo1KnockbackMult(): number { return 1; }
  get combo2KnockbackMult(): number { return 1; }
  get combo3KnockbackMult(): number { return 1.25; }

  /** The swings a consecutive-melee chain steps through, in order. The default is
   *  the universal three-hit combo — swing, mirrored backswing, then a wider
   *  finisher — built from this weapon's `fxType` and its per-swing multipliers.
   *  A weapon can override this wholesale for a bespoke combo. */
  get comboSwings(): ComboSwing[] {
    const base: StripFXType = isStripFx(this.fxType) ? this.fxType : "slash";
    return [
      { fxType: base, mirrored: false, damageMult: this.combo1DamageMult, knockbackMult: this.combo1KnockbackMult },
      { fxType: base, mirrored: true, damageMult: this.combo2DamageMult, knockbackMult: this.combo2KnockbackMult },
      { fxType: longFxVariant(base), mirrored: false, damageMult: this.combo3DamageMult, knockbackMult: this.combo3KnockbackMult },
    ];
  }

  // ── Hard (charged) swing ─────────────────────────────────────────────────────
  // A held attack releases a single heavy swing instead of a combo step. Its knobs
  // mirror the combo's — plain numeric getters the weapon-balance tool edits, so a
  // weapon or category can tune the payoff. Defaults match the combo finisher.
  get hardDamageMult(): number { return this.combo3DamageMult; }
  get hardKnockbackMult(): number { return this.combo3KnockbackMult; }

  /** The heavy swing a hold releases: the wider finisher strip, scaled by the
   *  hard multipliers. Overridable wholesale for a bespoke heavy attack. */
  get hardSwing(): ComboSwing {
    const base: StripFXType = isStripFx(this.fxType) ? this.fxType : "slash";
    return {
      fxType: longFxVariant(base),
      mirrored: false,
      damageMult: this.hardDamageMult,
      knockbackMult: this.hardKnockbackMult,
    };
  }

  /**
   * If set, this is a ranged weapon: attacking spawns a projectile using this
   * ammo id (see AMMO_REGISTRY) instead of a melee hitbox. Ranged weapons deal
   * no melee damage.
   */
  get ammoId(): string | undefined { return undefined; }
  /**
   * Client render style for ranged attacks: "held" keeps the weapon in hand and
   * plays a draw clip (bows, crossbows); "thrown" shows no in-hand sprite — the
   * projectile is the whole visual (knives, stars, boomerangs).
   */
  get rangedStyle(): RangedStyle | undefined { return undefined; }
  /**
   * If set, this weapon casts an area-of-effect blast around the caster (the
   * Mage's staff) rather than swinging or shooting. See AoeSpec.
   */
  get aoe(): AoeSpec | undefined { return undefined; }

  // The hurtbox is DERIVED from the attack art, never declared per weapon:
  // fxHurtboxAt reads the bounds generated from the FX strip's own pixels
  // (assets/generate-fx-hurtboxes.js). New attack art therefore gets a correct
  // hitbox for free, and no hand-tuned reach number can drift from what's
  // drawn. Anything that doesn't swing a strip — ranged, AOE — has no region.
  get getHurtbox(): GetHurtbox {
    if (this.ammoId !== undefined || this.aoe !== undefined || !isStripFx(this.fxType)) {
      return () => null;
    }
    const fx = this.fxType as StripFXType;
    return (px, py, facing, swingMs) => fxHurtboxAt(fx, swingMs, px, py, facing);
  }

  /** The hurtbox for a specific combo swing — its own FX strip's measured bounds,
   *  mirrored across the facing axis when the swing is a backswing. Melee only
   *  (ranged/AOE have no arc), so it returns null for those. */
  comboHurtbox(
    swing: ComboSwing,
    px: number,
    py: number,
    facing: Facing,
    swingMs: number,
  ): HitRegion | null {
    if (this.isRanged || this.isAoe) return null;
    return fxHurtboxAt(swing.fxType, swingMs, px, py, facing, swing.mirrored);
  }

  /** Client-side sprite path served from public/sprites/weapons/. */
  get iconPath(): string {
    return `/sprites/weapons/${CATEGORY_DIRS[this.category]}/${this.id}/${this.id}.png`;
  }

  /** True when attacking fires a projectile rather than swinging a melee arc. */
  get isRanged(): boolean {
    return this.ammoId !== undefined;
  }

  /** True when attacking erupts an AOE blast rather than a swing/shot. */
  get isAoe(): boolean {
    return this.aoe !== undefined;
  }
}

/** A concrete weapon class: `new`-able with no args and carrying its id, so the
 *  registry can be built from a plain array of classes the compiler still checks
 *  — the weapon analogue of EnemyClass. */
export type WeaponClass = { new (): Weapon };
