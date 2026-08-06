import { Weapon, WeaponClass } from "./base";

// ─── Swords ──────────────────────────────────────────────────────────────────
import { ShortSword }  from "./swords/short-sword";
import { Broadsword }  from "./swords/broadsword";
import { GildedSword } from "./swords/gilded-sword";

// ─── Axes ─────────────────────────────────────────────────────────────────────
import { BattleAxe } from "./axes/battle-axe";

// ─── Spears ───────────────────────────────────────────────────────────────────
import { Trident } from "./spears/trident";

// ─── Maces ────────────────────────────────────────────────────────────────────
import { MorningStar } from "./maces/morning-star";

// ─── Bows ─────────────────────────────────────────────────────────────────────
import { Shortbow } from "./bows/shortbow";

// ─── Thrown ───────────────────────────────────────────────────────────────────
import { ThrowingStar } from "./thrown/throwing-star";

// ─── Staves ───────────────────────────────────────────────────────────────────
import { OakStaff } from "./staves/oak-staff";

// ─── Enemy armaments ──────────────────────────────────────────────────────────
import { ENEMY_WEAPONS, EnemyWeaponId } from "./enemy";

// ─── Registry ─────────────────────────────────────────────────────────────────

// Every PLAYER weapon, as a class. Mirrors REGULAR_ENEMIES / BOSSES: the array of
// classes is the source of truth the compiler checks. This is also the ROLLABLE
// LOOT POOL — `partyRollableWeaponIds` draws from it — so enemy-only armaments
// live in ENEMY_WEAPONS (below) and can never drop as loot.
export const WEAPONS: WeaponClass[] = [
  ShortSword, Broadsword, GildedSword,
  BattleAxe,
  Trident,
  MorningStar,
  Shortbow,
  ThrowingStar,
  OakStaff,
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

// The loot-rollable player catalog as ids, DERIVED from WEAPONS (not the registry,
// which folds in ENEMY_WEAPONS). This is the ONLY set a drop/roll should draw from,
// so an enemy armament can never appear as loot. Enemy weapons still live in
// WEAPON_REGISTRY for wire resolution — they just aren't in here.
export const PLAYER_WEAPON_IDS: WeaponId[] = WEAPONS.map((W) => new W().id);

export type SwordId  = "short-sword" | "broadsword" | "gilded-sword";
export type AxeId     = "battle-axe";
export type SpearId   = "trident";
export type MaceId    = "morning-star";
export type BowId     = "shortbow";
export type ThrownId  = "throwing-star";
export type StaffId   = "oak-staff";

// A weapon id is any PLAYER weapon or any ENEMY armament — both are wire-referenced
// and resolvable in WEAPON_REGISTRY. Only the player ids are loot-rollable.
export type WeaponId = SwordId | AxeId | SpearId | MaceId | BowId | ThrownId | StaffId | EnemyWeaponId;

export { Weapon } from "./base";
export type { WeaponClass } from "./base";
export { Sword }  from "./swords/base";
export { Axe }    from "./axes/base";
export { Spear }  from "./spears/base";
export { Mace }   from "./maces/base";
export { Bow }    from "./bows/base";
export { Thrown } from "./thrown/base";
export { Staff }  from "./staves/base";
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
