import { CharacterClass, CharacterConfig, CharacterType, CHARACTER_TYPES } from "./base";
import { KNIGHT_CONFIG } from "./Knight";
import { ROGUE_CONFIG } from "./Rogue";
import { RANGER_CONFIG } from "./Ranger";
import { MAGE_CONFIG } from "./Mage";
import { WEAPON_REGISTRY, WeaponId } from "../weapons";
import type { WeaponCategory } from "../weapons/base";

export const CHARACTER_REGISTRY: Record<CharacterClass, CharacterConfig> = {
  knight: KNIGHT_CONFIG,
  rogue:  ROGUE_CONFIG,
  ranger: RANGER_CONFIG,
  mage:   MAGE_CONFIG,
};

export function getCharacterConfig(cls: CharacterClass): CharacterConfig {
  return CHARACTER_REGISTRY[cls];
}

/** The class for an id that came off the wire, or the knight if it isn't one.
 *
 *  A class id is UNTRUSTED input — it arrives as a join option and again in
 *  `setLoadout` — and casting it instead of checking it is not a cosmetic
 *  mistake: an unknown class yields an undefined `CharacterConfig` and the
 *  `Player` constructor throws on `charConfig.maxHp`, taking the join down with
 *  it. This is the character-side counterpart of `resolveTemplate` for weapons. */
export function resolveCharacterClass(id: string | undefined): CharacterClass {
  return id !== undefined && id in CHARACTER_REGISTRY
    ? (id as CharacterClass)
    : "knight";
}

/** The skin for an id off the wire, or the default. Purely visual — an unknown
 *  skin only means the client has no spritesheet to draw — but validated for the
 *  same reason: nothing a client sends should reach the game as-is. */
export function resolveCharacterType(id: string | undefined): CharacterType {
  return id !== undefined && (CHARACTER_TYPES as readonly string[]).includes(id)
    ? (id as CharacterType)
    : "guy";
}

const ALL_CLASSES: CharacterClass[] = ["knight", "rogue", "ranger", "mage"];

/** True when `cls` may wield weapons of `category` — a membership test against the
 *  class's own declared capability, not a lookup table. */
export function canClassUseCategory(cls: CharacterClass, category: WeaponCategory): boolean {
  return CHARACTER_REGISTRY[cls].usableCategories.includes(category);
}

/** True when `cls` may equip the weapon with this id. Reads only the weapon's
 *  category from the registry; the permission itself lives on the class. */
export function canClassUseWeapon(cls: CharacterClass, weaponId: string): boolean {
  const weapon = WEAPON_REGISTRY[weaponId];
  return weapon !== undefined && canClassUseCategory(cls, weapon.category);
}

/** The categories UNIQUE to `cls` — those no other class can use. This is a
 *  class's identity (Mage → staff, Knight → hammer/mace) and the pool its FIRST
 *  weapon rolls from. Derived by set-difference across the class declarations, so
 *  there is no separate "exclusive" list to keep in sync. */
export function firstRollCategories(cls: CharacterClass): WeaponCategory[] {
  const othersUse = new Set<WeaponCategory>();
  for (const other of ALL_CLASSES) {
    if (other === cls) continue;
    for (const cat of CHARACTER_REGISTRY[other].usableCategories) othersUse.add(cat);
  }
  return CHARACTER_REGISTRY[cls].usableCategories.filter((cat) => !othersUse.has(cat));
}

/** Weapon ids in `cls`'s unique categories — the concrete first-weapon roll pool. */
export function firstRollWeaponIds(cls: CharacterClass): WeaponId[] {
  const cats = new Set(firstRollCategories(cls));
  return (Object.keys(WEAPON_REGISTRY) as WeaponId[])
    .filter((id) => cats.has(WEAPON_REGISTRY[id].category));
}

/** Weapon ids at least one present class can equip — the D10 loot filter, so a
 *  weapon nobody in the party can use never rolls. Empty party (defensive) is
 *  treated as "no restriction" and returns every weapon. */
export function partyRollableWeaponIds(classes: CharacterClass[]): WeaponId[] {
  const all = Object.keys(WEAPON_REGISTRY) as WeaponId[];
  if (classes.length === 0) return all;
  return all.filter((id) => classes.some((cls) => canClassUseWeapon(cls, id)));
}

/** Boot sanity check: every class must own at least one unique category, or its
 *  first-weapon roll pool would be empty. Mirrors assertUpgradesCoverAllIds — a
 *  cheap invariant, not a lookup table. */
export function assertClassesHaveFirstRollPool(): void {
  for (const cls of ALL_CLASSES) {
    if (firstRollWeaponIds(cls).length === 0) {
      throw new Error(`Class "${cls}" has no unique weapon category to roll a first weapon from.`);
    }
  }
}

export * from "./base";
export * from "./Knight";
export * from "./Rogue";
export * from "./Ranger";
export * from "./Mage";
