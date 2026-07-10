import { Facing } from "../types";

export type AttackFXType = "slash" | "long-slash" | "stab" | "long-stab";
export type WeaponCategory = "sword" | "axe" | "spear" | "rapier" | "mace" | "dagger" | "hammer" | "bow" | "crossbow" | "staff" | "thrown";

/** How a ranged weapon renders its attack client-side (see Entity.setupCharacter). */
export type RangedStyle = "held" | "thrown";

export interface RectHitRegion  { shape: "rect";   x: number; y: number; w: number; h: number }
export interface CircleHitRegion { shape: "circle"; cx: number; cy: number; r: number }
export type HitRegion = RectHitRegion | CircleHitRegion;
export type GetHurtbox = (px: number, py: number, facing: Facing) => HitRegion | null;

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
  getHurtbox: GetHurtbox;
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
   * getHurtbox: () => null so they deal no melee damage.
   */
  ammoId?: string;
  /**
   * Client render style for ranged attacks: "held" keeps the weapon in hand and
   * plays a draw clip (bows, crossbows); "thrown" shows no in-hand sprite — the
   * projectile is the whole visual (knives, stars, boomerangs).
   */
  rangedStyle?: RangedStyle;
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
  /** Client-side sprite path served from public/sprites/weapons/. */
  readonly iconPath: string;

  constructor(opts: WeaponOpts) {
    this.id = opts.id;
    this.name = opts.name;
    this.category = opts.category;
    this.fxType = opts.fxType;
    this.damage = opts.damage;
    this.attackCooldownMs = opts.attackCooldownMs;
    this.attackForce = opts.attackForce;
    this.getHurtbox = opts.getHurtbox;
    this.iconAngle = opts.iconAngle;
    this.ammoId = opts.ammoId;
    this.rangedStyle = opts.rangedStyle;
    this.iconPath = `/sprites/weapons/${CATEGORY_DIRS[opts.category]}/${opts.id}/${opts.id}.png`;
  }

  /** True when attacking fires a projectile rather than swinging a melee arc. */
  get isRanged(): boolean {
    return this.ammoId !== undefined;
  }
}

/** Partial override for category subclass constructors — id and name are required; everything else falls back to category defaults. */
export type Override = Partial<WeaponOpts> & Pick<WeaponOpts, "id" | "name">;

/** Standard melee hurtbox: forward-facing rect, inner edge at body surface.
 *  range = forward reach, width = arc width, offset = inner-edge pullback from center. */
export function makeMeleeHurtbox(range: number, width: number, offset = -6): GetHurtbox {
  return (px, py, facing) => {
    switch (facing) {
      case "right": return { shape: "rect", x: px + offset,          y: py - width / 2,      w: range, h: width };
      case "left":  return { shape: "rect", x: px - range - offset,  y: py - width / 2,      w: range, h: width };
      case "down":  return { shape: "rect", x: px - width / 2,       y: py + offset,         w: width, h: range };
      case "up":    return { shape: "rect", x: px - width / 2,       y: py - range - offset, w: width, h: range };
    }
  };
}
