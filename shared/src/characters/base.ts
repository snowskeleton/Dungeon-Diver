// Type-only: erased at runtime, so referencing the weapon categories here creates
// no import cycle with the weapons package (which never imports characters).
import type { WeaponCategory } from "../weapons/base";

/** Every humanoid spritesheet, as a VALUE — the identity of a 15×4 humanoid sheet
 *  (its texture key / PNG name), NOT "a playable character". Players AND the
 *  humanoid enemies (skeleton, skeleton-mage) are drawn from these sheets, so the
 *  sheet identity lives above the player concept: {@link PLAYER_SKINS} is the
 *  playable SUBSET. The humanoid sprite infra (client `HumanoidSprites`) keys off
 *  `HumanoidSkin`; only the player-facing paths narrow to `CharacterType`.
 *
 *  A runtime list is needed because a chosen skin arrives from a client as an
 *  untrusted string and has to be validated, not cast (see resolveCharacterType). */
export const HUMANOID_SKINS = [
  "guy",
  "gal",
  "colt",
  "gigante",
  "skeleton",
  "skeleton-mage",
] as const;

export type HumanoidSkin = typeof HUMANOID_SKINS[number];

/** The PLAYABLE humanoid skins — the subset of {@link HUMANOID_SKINS} a player may
 *  pick. skeleton + skeleton-mage are deliberately absent: they're enemies (drawn
 *  from the same sheets), not skins. Guy Blue, Gal Green, The Fool, and the
 *  reptiles were removed from the roster earlier. */
export const PLAYER_SKINS = [
  "guy",
  "gal",
  "colt",
  "gigante",
] as const satisfies readonly HumanoidSkin[];

export type CharacterType = typeof PLAYER_SKINS[number];
export type CharacterClass = "knight" | "rogue" | "ranger" | "mage";

/**
 * A playable class, OO like {@link Enemy} / {@link Weapon} / {@link Upgrade} —
 * NOT a flat config record. Each class is its own `Character` subclass whose
 * stats are compiler-checked getters resolved up this `extends` chain, and the
 * roster is a plain array of instances (`CHARACTERS` in ./index.ts). There is no
 * `CHARACTER_REGISTRY` config object: the id→instance lookup used for wire
 * validation is DERIVED from that array, the same way `WEAPON_REGISTRY` derives
 * from `WEAPONS`.
 *
 * Add a class by subclassing this and appending it to `CHARACTERS`.
 */
export abstract class Character {
  /** The wire id for this class. Typed `CharacterClass`, so a typo is a compile error. */
  abstract get id(): CharacterClass;
  abstract get name(): string;
  abstract get maxHp(): number;
  abstract get speed(): number;

  /**
   * Every weapon CATEGORY this class may wield — its full capability, declared
   * on the class itself (D9/D18). The restriction lives here, not in a central
   * category→class table: loot rolls and the equip check QUERY the classes (see
   * canClassUseWeapon / firstRollCategories / partyRollableWeaponIds in index.ts)
   * rather than consulting a lookup that could drift from the classes.
   *
   * Categories owned by exactly one class (a class's `firstRollCategories`) are
   * its identity — the Mage's staves, the Knight's hammers/maces — while the
   * four melee categories (sword/axe/spear/rapier) appear on every list as the
   * shared backbone. Players no longer start holding a weapon; a class's first
   * weapon is rolled from its unique categories at the floor-1 supply room.
   */
  abstract get usableCategories(): readonly WeaponCategory[];

  /** True when this class may wield weapons of `category`. A membership test
   *  against the class's own declared capability, not a lookup table. */
  canUseCategory(category: WeaponCategory): boolean {
    return this.usableCategories.includes(category);
  }
}
