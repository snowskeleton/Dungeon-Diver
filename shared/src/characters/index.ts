import { Character, CharacterClass, CharacterType, PLAYER_SKINS } from "./base";
import { Knight } from "./Knight";
import { Rogue } from "./Rogue";
import { Ranger } from "./Ranger";
import { Mage } from "./Mage";
import { WEAPON_REGISTRY, resolveWeapon, WeaponId } from "../weapons";
import type { WeaponCategory } from "../weapons/base";

/** The playable roster, as a plain array of `Character` instances — mirrors
 *  `REGULAR_ENEMIES` / `WEAPONS`. This is the authoritative list; everything else
 *  is DERIVED from it. Add a class by writing its subclass and appending it here. */
export const CHARACTERS: Character[] = [
  new Knight(),
  new Rogue(),
  new Ranger(),
  new Mage(),
];

/** id → the one shared `Character` instance, DERIVED from `CHARACTERS`. This is
 *  the character-side counterpart of `WEAPON_REGISTRY` (a genuine id→object
 *  lookup, because the class id crosses the wire) — not a hand-authored config
 *  object. */
const CHARACTER_BY_CLASS = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
) as Record<CharacterClass, Character>;

/** Every class id, DERIVED from the roster. */
export const CHARACTER_CLASSES: CharacterClass[] = CHARACTERS.map((c) => c.id);

/** The `Character` for a class id. */
export function getCharacter(cls: CharacterClass): Character {
  return CHARACTER_BY_CLASS[cls];
}

/** The class for an id that came off the wire, or the knight if it isn't one.
 *
 *  A class id is UNTRUSTED input — it arrives as a join option and again in
 *  `setLoadout` — and casting it instead of checking it is not a cosmetic
 *  mistake: an unknown class yields an undefined `Character` and the `Player`
 *  constructor throws on `character.maxHp`, taking the join down with it. This is
 *  the character-side counterpart of `resolveTemplate` for weapons. */
export function resolveCharacterClass(id: string | undefined): CharacterClass {
  return id !== undefined && id in CHARACTER_BY_CLASS
    ? (id as CharacterClass)
    : "knight";
}

/** The skin for an id off the wire, or the default. Purely visual — an unknown
 *  skin only means the client has no spritesheet to draw — but validated for the
 *  same reason: nothing a client sends should reach the game as-is. */
export function resolveCharacterType(id: string | undefined): CharacterType {
  return id !== undefined && (PLAYER_SKINS as readonly string[]).includes(id)
    ? (id as CharacterType)
    : "guy";
}

/** True when `cls` may wield weapons of `category` — asks the class itself. */
export function canClassUseCategory(cls: CharacterClass, category: WeaponCategory): boolean {
  return getCharacter(cls).canUseCategory(category);
}

/** True when `cls` may equip the weapon with this id. Reads only the weapon's
 *  category from the registry; the permission itself lives on the class. */
export function canClassUseWeapon(cls: CharacterClass, weaponId: string): boolean {
  const weapon = resolveWeapon(weaponId);
  return weapon !== undefined && canClassUseCategory(cls, weapon.category);
}

/** The categories UNIQUE to `cls` — those no other class can use. This is a
 *  class's identity (Mage → staff, Knight → hammer/mace) and the pool its FIRST
 *  weapon rolls from. Derived by set-difference across the class declarations, so
 *  there is no separate "exclusive" list to keep in sync. */
export function firstRollCategories(cls: CharacterClass): WeaponCategory[] {
  const othersUse = new Set<WeaponCategory>();
  for (const other of CHARACTERS) {
    if (other.id === cls) continue;
    for (const cat of other.usableCategories) othersUse.add(cat);
  }
  return getCharacter(cls).usableCategories.filter((cat) => !othersUse.has(cat));
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
  for (const cls of CHARACTER_CLASSES) {
    if (firstRollWeaponIds(cls).length === 0) {
      throw new Error(`Class "${cls}" has no unique weapon category to roll a first weapon from.`);
    }
  }
}

export * from "./base";
export { Knight } from "./Knight";
export { Rogue } from "./Rogue";
export { Ranger } from "./Ranger";
export { Mage } from "./Mage";
