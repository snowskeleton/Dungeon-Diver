import { Facing } from "../types";
import { fxHurtboxAt } from "./hurtbox";

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

export interface WeaponOpts {
  id: string;
  name: string;
  category: WeaponCategory;
  fxType: AttackFXType;
  damage: number;
  attackCooldownMs: number;
  attackForce: number;
  /**
   * Rotation offset (degrees) applied to the weapon icon on top of the base
   * facing rotation. The base rotation points the icon toward the attack target
   * (right=90°, down=180°, left=270°, up=0°) because icons are drawn pointing UP.
   * Use this to tilt the icon for the weapon's natural hold angle — e.g. -45 on a
   * slashing weapon so the blade sits diagonally mid-swing rather than fully extended.
   */
  iconAngle: number;
  /**
   * If set, this is a ranged weapon: attacking spawns a projectile using this
   * ammo id (see AMMO_REGISTRY) instead of a melee hitbox. Ranged weapons pass
   * they deal no melee damage.
   */
  ammoId?: string;
  /**
   * Client render style for ranged attacks: "held" keeps the weapon in hand and
   * plays a draw clip (bows, crossbows); "thrown" shows no in-hand sprite — the
   * projectile is the whole visual (knives, stars, boomerangs).
   */
  rangedStyle?: RangedStyle;
  /**
   * If set, this weapon casts an area-of-effect blast around the caster (the
   * Mage's staff) rather than swinging or shooting. See AoeSpec.
   */
  aoe?: AoeSpec;
}

export class Weapon {
  readonly id: string;
  readonly name: string;
  readonly category: WeaponCategory;
  readonly fxType: AttackFXType;
  readonly damage: number;
  readonly attackCooldownMs: number;
  readonly attackForce: number;
  readonly getHurtbox: GetHurtbox;
  readonly iconAngle: number;
  readonly ammoId?: string;
  readonly rangedStyle?: RangedStyle;
  readonly aoe?: AoeSpec;
  /** Client-side sprite path served from public/sprites/weapons/. */
  readonly iconPath: string;

  constructor(opts: WeaponOpts) {
    this.id = opts.id;
    this.name = opts.name;
    this.category = opts.category;
    this.fxType = opts.fxType;
    // The hurtbox is DERIVED from the attack art, never declared per weapon:
    // fxHurtboxAt reads the bounds generated from the FX strip's own pixels
    // (assets/generate-fx-hurtboxes.js). New attack art therefore gets a correct
    // hitbox for free, and no hand-tuned reach number can drift from what's
    // drawn. Anything that doesn't swing a strip — ranged, AOE — has no region.
    this.getHurtbox = (opts.ammoId !== undefined || opts.aoe !== undefined || !isStripFx(opts.fxType))
      ? () => null
      : (px, py, facing, swingMs) => fxHurtboxAt(opts.fxType as StripFXType, swingMs, px, py, facing);
    this.damage = opts.damage;
    this.attackCooldownMs = opts.attackCooldownMs;
    this.attackForce = opts.attackForce;
    this.iconAngle = opts.iconAngle;
    this.ammoId = opts.ammoId;
    this.rangedStyle = opts.rangedStyle;
    this.aoe = opts.aoe;
    this.iconPath = `/sprites/weapons/${CATEGORY_DIRS[opts.category]}/${opts.id}/${opts.id}.png`;
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

/** Partial override for category subclass constructors — id and name are required; everything else falls back to category defaults. */
export type Override = Partial<WeaponOpts> & Pick<WeaponOpts, "id" | "name">;
