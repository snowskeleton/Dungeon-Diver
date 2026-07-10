import { CharacterClass, CharacterConfig } from "./base";
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

export * from "./base";
export * from "./Knight";
export * from "./Rogue";
export * from "./Ranger";
export * from "./Mage";
