import { Weapon, WeaponClass } from "./base";

// ─── Swords ──────────────────────────────────────────────────────────────────
import { ShortSword }     from "./swords/short-sword";
import { Broadsword }     from "./swords/broadsword";
import { Flamberge }      from "./swords/flamberge";
import { OrnateSword }    from "./swords/ornate-sword";
import { CrimsonBlade }   from "./swords/crimson-blade";
import { FrostBlade }     from "./swords/frost-blade";
import { GoldBlade }      from "./swords/gold-blade";
import { MysticBlade }    from "./swords/mystic-blade";
import { WoodenSword }    from "./swords/wood-sword";
import { Sabre }          from "./swords/sabre";
import { GildedSword }    from "./swords/gilded-sword";
import { Stiletto }       from "./swords/stiletto";
import { SerpentBlade }   from "./swords/serpent-blade";
import { TealBlade }      from "./swords/teal-blade";
import { CrystalBlade }   from "./swords/crystal-blade";
import { InfernoBlade }   from "./swords/inferno-blade";
import { ShadowBlade }    from "./swords/shadow-blade";
import { LightningBlade } from "./swords/lightning-blade";

// ─── Axes ─────────────────────────────────────────────────────────────────────
import { BattleAxe } from "./axes/battle-axe";
import { Hatchet }   from "./axes/hatchet";
import { MoonAxe }   from "./axes/moon-axe";
import { DoubleAxe } from "./axes/double-axe";
import { WarAxe }    from "./axes/war-axe";
import { DarkAxe }   from "./axes/dark-axe";

// ─── Spears ───────────────────────────────────────────────────────────────────
import { Javelin } from "./spears/javelin";
import { Lance }   from "./spears/lance";
import { Spear }   from "./spears/spear";
import { Trident } from "./spears/trident";

// ─── Rapiers ──────────────────────────────────────────────────────────────────
import { BlueRapier }   from "./rapiers/blue-rapier";
import { SilverRapier } from "./rapiers/silver-rapier";
import { TealRapier }   from "./rapiers/teal-rapier";

// ─── Maces ────────────────────────────────────────────────────────────────────
import { StarMace }    from "./maces/star-mace";
import { MorningStar } from "./maces/morning-star";
import { Flail }       from "./maces/flail";
import { Club }        from "./maces/club";
import { OrbMace }     from "./maces/orb-mace";

// ─── Daggers ──────────────────────────────────────────────────────────────────
import { Kris }         from "./daggers/kris";
import { CurvedDagger } from "./daggers/curved-dagger";

// ─── Hammers ──────────────────────────────────────────────────────────────────
import { WarHammer } from "./hammers/war-hammer";

// ─── Bows ─────────────────────────────────────────────────────────────────────
import { Shortbow } from "./bows/shortbow";
import { Longbow }  from "./bows/longbow";

// ─── Crossbows ────────────────────────────────────────────────────────────────
import { Crossbow } from "./crossbows/crossbow";

// ─── Thrown ───────────────────────────────────────────────────────────────────
import { ThrowingKnife }  from "./thrown/throwing-knife";
import { ThrowingStar }   from "./thrown/throwing-star";
import { Boomerang }      from "./thrown/boomerang";
import { SteelBoomerang } from "./thrown/steel-boomerang";

// ─── Staves ───────────────────────────────────────────────────────────────────
import { OakStaff }     from "./staves/oak-staff";
import { Cane }         from "./staves/cane";
import { ArcaneStaff }  from "./staves/arcane-staff";
import { RubyStaff }    from "./staves/ruby-staff";
import { EmeraldStaff } from "./staves/emerald-staff";
import { CrystalWand }  from "./staves/crystal-wand";

// ─── Registry ─────────────────────────────────────────────────────────────────

// Every weapon, as a class. Mirrors REGULAR_ENEMIES / BOSSES: the array of
// classes is the source of truth the compiler checks, and WEAPON_REGISTRY below
// is the id→template lookup derived from it (weapons, unlike enemies, are
// referenced by id across the wire, so the map is a genuine need, not a shortcut).
export const WEAPONS: WeaponClass[] = [
  ShortSword, Broadsword, Flamberge, OrnateSword, CrimsonBlade, FrostBlade,
  GoldBlade, MysticBlade, WoodenSword, Sabre, GildedSword, Stiletto,
  SerpentBlade, TealBlade, CrystalBlade, InfernoBlade, ShadowBlade, LightningBlade,
  BattleAxe, Hatchet, MoonAxe, DoubleAxe, WarAxe, DarkAxe,
  Javelin, Lance, Spear, Trident,
  BlueRapier, SilverRapier, TealRapier,
  StarMace, MorningStar, Flail, Club, OrbMace,
  Kris, CurvedDagger,
  WarHammer,
  Shortbow, Longbow,
  Crossbow,
  ThrowingKnife, ThrowingStar, Boomerang, SteelBoomerang,
  OakStaff, Cane, ArcaneStaff, RubyStaff, EmeraldStaff, CrystalWand,
];

export const WEAPON_REGISTRY: Record<string, Weapon> =
  Object.fromEntries(WEAPONS.map((W) => { const w = new W(); return [w.id, w]; }));

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
export type { WeaponClass } from "./base";
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
export type { AttackFXType, WeaponCategory, RangedStyle, HitRegion, RectHitRegion, CircleHitRegion, GetHurtbox, StripFXType } from "./base";
export type { FxFrameBounds } from "./fxHurtboxes.generated";
export {
  WeaponInstance,
  WeaponMod,
  foldStat,
  resolveCooldown,
  MIN_ATTACK_COOLDOWN_MS,
} from "./instance";
export type { WeaponView, AmmoView, WeaponSlotView } from "./instance";
