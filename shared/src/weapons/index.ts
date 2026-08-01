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

// ─── Enemy armaments ──────────────────────────────────────────────────────────
import { ENEMY_WEAPONS, EnemyWeaponId } from "./enemy";

// ─── Registry ─────────────────────────────────────────────────────────────────

// Every PLAYER weapon, as a class. Mirrors REGULAR_ENEMIES / BOSSES: the array of
// classes is the source of truth the compiler checks. This is also the ROLLABLE
// LOOT POOL — `partyRollableWeaponIds` draws from it — so enemy-only armaments
// live in ENEMY_WEAPONS (below) and can never drop as loot.
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

// WEAPON_REGISTRY is the id→template lookup, derived from BOTH the player catalog
// and the enemy armaments. It exists for ONE reason: a weapon identity crosses the
// Colyseus wire as a bare string (PlayerState.weaponId, a shop pedestal, an enemy's
// armament), and the string must be turned back into its template object on receipt.
// That string→object step is the network boundary; it cannot be a direct reference.
//
// The map is the client's HALF of that boundary, not an id→config table: it holds
// real `Weapon` objects and is built FROM the class array (every key is some class's
// `id: WeaponId`, so a typo is a compile error at the class, never here). Look weapons
// up ONLY through `resolveWeapon` — the one place a wire string is trusted — so no
// `as WeaponId` cast is scattered across the ~15 call sites that resolve a wire id.
// Only WEAPONS is loot-rollable; the registry is the superset for lookup.
export const WEAPON_REGISTRY: Record<WeaponId, Weapon> =
  Object.fromEntries(
    [...WEAPONS, ...ENEMY_WEAPONS].map((W) => { const w = new W(); return [w.id, w]; }),
  ) as Record<WeaponId, Weapon>;

/** Resolve a weapon template from an id that arrived over the wire (or any untrusted
 *  string). The single seam where a `string` becomes a `Weapon` — returns undefined
 *  for an unknown id rather than inventing a weapon. Everywhere else holds the object. */
export function resolveWeapon(id: string): Weapon | undefined {
  return (WEAPON_REGISTRY as Record<string, Weapon | undefined>)[id];
}

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

// A weapon id is any PLAYER weapon or any ENEMY armament — both are wire-referenced
// and resolvable in WEAPON_REGISTRY. Only the player ids are loot-rollable.
export type WeaponId = SwordId | AxeId | SpearId | RapierId | MaceId | DaggerId | HammerId | BowId | CrossbowId | ThrownId | StaffId | EnemyWeaponId;

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
export { ENEMY_WEAPONS } from "./enemy";
// The concrete enemy-armament classes, so a server-side ArmedEnemy holds its weapon
// as a direct object reference (`new BeastAxe()`) rather than a string id looked up
// in the registry — the weapon never crosses the wire, so it need never be an id.
export {
  BeastSword,
  BeastAxe,
  BeastMace,
  SkeletonBlade,
  SkeletonStaff,
  SoldierLance,
} from "./enemy";
export type { EnemyWeaponId } from "./enemy";
export { isStripFx, longFxVariant } from "./base";
export { fxHurtboxAt, swingDurationMs } from "./hurtbox";
export { FX_HURTBOX_FRAMES, FX_FRAME_MS } from "./fxHurtboxes.generated";
export type { AttackFXType, WeaponCategory, RangedStyle, HitRegion, RectHitRegion, CircleHitRegion, GetHurtbox, StripFXType, ComboSwing } from "./base";
export type { FxFrameBounds } from "./fxHurtboxes.generated";
export {
  WeaponInstance,
  WeaponMod,
  weaponSignature,
  NO_TINT,
  foldStat,
  resolveCooldown,
  MIN_ATTACK_COOLDOWN_MS,
} from "./instance";
export type { WeaponView, AmmoView, WeaponSlotView } from "./instance";
