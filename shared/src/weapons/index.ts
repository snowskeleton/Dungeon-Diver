import { Weapon } from "./base";

// ─── Swords ──────────────────────────────────────────────────────────────────
import shortSword     from "./swords/short-sword";
import broadsword     from "./swords/broadsword";
import flamberge      from "./swords/flamberge";
import ornateSword    from "./swords/ornate-sword";
import crimsonBlade   from "./swords/crimson-blade";
import frostBlade     from "./swords/frost-blade";
import goldBlade      from "./swords/gold-blade";
import mysticBlade    from "./swords/mystic-blade";
import woodSword      from "./swords/wood-sword";
import sabre          from "./swords/sabre";
import gildedSword    from "./swords/gilded-sword";
import stiletto       from "./swords/stiletto";
import serpentBlade   from "./swords/serpent-blade";
import tealBlade      from "./swords/teal-blade";
import crystalBlade   from "./swords/crystal-blade";
import infernoBlade   from "./swords/inferno-blade";
import shadowBlade    from "./swords/shadow-blade";
import lightningBlade from "./swords/lightning-blade";

// ─── Axes ─────────────────────────────────────────────────────────────────────
import battleAxe  from "./axes/battle-axe";
import hatchet    from "./axes/hatchet";
import moonAxe    from "./axes/moon-axe";
import doubleAxe  from "./axes/double-axe";
import warAxe     from "./axes/war-axe";
import darkAxe    from "./axes/dark-axe";

// ─── Spears ───────────────────────────────────────────────────────────────────
import javelin from "./spears/javelin";
import lance   from "./spears/lance";
import spear   from "./spears/spear";
import trident from "./spears/trident";

// ─── Rapiers ──────────────────────────────────────────────────────────────────
import blueRapier   from "./rapiers/blue-rapier";
import silverRapier from "./rapiers/silver-rapier";
import tealRapier   from "./rapiers/teal-rapier";

// ─── Maces ────────────────────────────────────────────────────────────────────
import starMace    from "./maces/star-mace";
import morningStar from "./maces/morning-star";
import flail       from "./maces/flail";
import club        from "./maces/club";
import orbMace     from "./maces/orb-mace";

// ─── Daggers ──────────────────────────────────────────────────────────────────
import kris         from "./daggers/kris";
import curvedDagger from "./daggers/curved-dagger";

// ─── Hammers ──────────────────────────────────────────────────────────────────
import warHammer from "./hammers/war-hammer";

// ─── Bows ─────────────────────────────────────────────────────────────────────
import shortbow from "./bows/shortbow";
import longbow  from "./bows/longbow";

// ─── Crossbows ────────────────────────────────────────────────────────────────
import crossbow from "./crossbows/crossbow";

// ─── Thrown ───────────────────────────────────────────────────────────────────
import throwingKnife  from "./thrown/throwing-knife";
import throwingStar   from "./thrown/throwing-star";
import boomerang      from "./thrown/boomerang";
import steelBoomerang from "./thrown/steel-boomerang";

// ─── Staves ───────────────────────────────────────────────────────────────────
import oakStaff     from "./staves/oak-staff";
import cane         from "./staves/cane";
import arcaneStaff  from "./staves/arcane-staff";
import rubyStaff    from "./staves/ruby-staff";
import emeraldStaff from "./staves/emerald-staff";
import crystalWand  from "./staves/crystal-wand";

// ─── Registry ─────────────────────────────────────────────────────────────────

const ALL_WEAPONS: Weapon[] = [
  shortSword, broadsword, flamberge, ornateSword, crimsonBlade, frostBlade,
  goldBlade, mysticBlade, woodSword, sabre, gildedSword, stiletto,
  serpentBlade, tealBlade, crystalBlade, infernoBlade, shadowBlade, lightningBlade,
  battleAxe, hatchet, moonAxe, doubleAxe, warAxe, darkAxe,
  javelin, lance, spear, trident,
  blueRapier, silverRapier, tealRapier,
  starMace, morningStar, flail, club, orbMace,
  kris, curvedDagger,
  warHammer,
  shortbow, longbow,
  crossbow,
  throwingKnife, throwingStar, boomerang, steelBoomerang,
  oakStaff, cane, arcaneStaff, rubyStaff, emeraldStaff, crystalWand,
];

export const WEAPON_REGISTRY: Record<string, Weapon> = Object.fromEntries(ALL_WEAPONS.map(w => [w.id, w]));

export type SwordId     = "short-sword" | "broadsword" | "flamberge" | "ornate-sword" | "crimson-blade" | "frost-blade" | "gold-blade" | "mystic-blade" | "wood-sword" | "sabre" | "gilded-sword" | "stiletto" | "serpent-blade" | "teal-blade" | "crystal-blade" | "inferno-blade" | "shadow-blade" | "lightning-blade";
export type AxeId       = "battle-axe" | "hatchet" | "moon-axe" | "double-axe" | "war-axe" | "dark-axe";
export type SpearId     = "javelin" | "lance" | "spear" | "trident";
export type RapierId    = "blue-rapier" | "silver-rapier" | "teal-rapier";
export type MaceId      = "star-mace" | "morning-star" | "flail" | "club" | "orb-mace";
export type DaggerId    = "kris" | "curved-dagger";
export type HammerId    = "war-hammer";
export type BowId       = "shortbow" | "longbow";
export type CrossbowId  = "crossbow";
export type ThrownId    = "throwing-knife" | "throwing-star" | "boomerang" | "steel-boomerang";
export type StaffId     = "oak-staff" | "cane" | "arcane-staff" | "ruby-staff" | "emerald-staff" | "crystal-wand";

export type WeaponId = SwordId | AxeId | SpearId | RapierId | MaceId | DaggerId | HammerId | BowId | CrossbowId | ThrownId | StaffId;

export { Weapon } from "./base";
export { Sword }    from "./swords/base";
export { Axe }      from "./axes/base";
export { Spear }    from "./spears/base";
export { Rapier }   from "./rapiers/base";
export { Mace }     from "./maces/base";
export { Dagger }   from "./daggers/base";
export { Hammer }   from "./hammers/base";
export { Bow }      from "./bows/base";
export { Crossbow } from "./crossbows/base";
export { Thrown }   from "./thrown/base";
export { Staff }    from "./staves/base";
export { isStripFx } from "./base";
export { fxHurtboxAt, swingDurationMs } from "./hurtbox";
export { FX_HURTBOX_FRAMES, FX_FRAME_MS } from "./fxHurtboxes.generated";
export type { AttackFXType, WeaponCategory, RangedStyle, HitRegion, RectHitRegion, CircleHitRegion, GetHurtbox, WeaponOpts, StripFXType } from "./base";
export type { FxFrameBounds } from "./fxHurtboxes.generated";
export {
  WeaponInstance,
  WeaponMod,
  foldStat,
  resolveCooldown,
  MIN_ATTACK_COOLDOWN_MS,
} from "./instance";
export type { WeaponView, AmmoView, WeaponSlotView } from "./instance";
