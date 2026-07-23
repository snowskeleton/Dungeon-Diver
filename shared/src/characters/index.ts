import { CharacterClass, CharacterConfig, CharacterType, CHARACTER_TYPES } from "./base";
import { KNIGHT_CONFIG } from "./Knight";
import { ROGUE_CONFIG } from "./Rogue";
import { RANGER_CONFIG } from "./Ranger";
import { MAGE_CONFIG } from "./Mage";

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

export * from "./base";
export * from "./Knight";
export * from "./Rogue";
export * from "./Ranger";
export * from "./Mage";
