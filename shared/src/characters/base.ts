// Type-only: erased at runtime, so declaring the categories a class can wield
// here creates no import cycle with the weapons package (which never imports
// characters).
import type { WeaponCategory } from "../weapons/base";

/** Every humanoid skin, as a VALUE — the union below is derived from it, so the
 *  two can never drift. A runtime list is needed because the skin id arrives from
 *  a client as an untrusted string and has to be validated, not cast (see
 *  resolveCharacterType). */
export const CHARACTER_TYPES = [
  "guy",
  "guy-blue",
  "gal",
  "gal-green",
  "skeleton",
  "skeleton-mage",
  "colt",
  "the-fool",
  "gigante",
  "reptile",
  "kobold",
  "scaleless",
] as const;

export type CharacterType = typeof CHARACTER_TYPES[number];
export type CharacterClass = "knight" | "rogue" | "ranger" | "mage";

export interface CharacterConfig {
  id: CharacterClass;
  name: string;
  maxHp: number;
  speed: number;
  /**
   * Every weapon CATEGORY this class may wield — its full capability, declared
   * on the class itself (D9/D18). The restriction lives here, not in a central
   * category→class table: loot rolls and the equip check QUERY these lists (see
   * canClassUseWeapon / firstRollCategories / partyRollableWeaponIds in index.ts)
   * rather than consulting a lookup that could drift from the classes.
   *
   * Categories owned by exactly one class (a class's `firstRollCategories`) are
   * its identity — the Mage's staves, the Knight's hammers/maces — while the
   * four melee categories (sword/axe/spear/rapier) appear on every list as the
   * shared backbone. Players no longer start holding a weapon; a class's first
   * weapon is rolled from its unique categories at the floor-1 supply room.
   */
  usableCategories: readonly WeaponCategory[];
}
