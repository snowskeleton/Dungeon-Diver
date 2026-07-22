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
  get attackCooldownMs(): number { return 500; }
  get attackForce(): number { return 5; }
  /**
   * Rotation offset (degrees) applied to the weapon icon on top of the base
   * facing rotation. The base rotation points the icon toward the attack target
   * (right=90°, down=180°, left=270°, up=0°) because icons are drawn pointing UP.
   * Use this to tilt the icon for the weapon's natural hold angle — e.g. -45 on a
   * slashing weapon so the blade sits diagonally mid-swing rather than fully extended.
   */
  get iconAngle(): number { return 0; }
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
