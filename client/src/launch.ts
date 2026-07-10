import { CHARACTER_REGISTRY, CharacterClass, CharacterType, DebugConfig, WeaponId } from "shared";
import { CharacterPicker, CharacterChoice } from "./ui/CharacterPicker";
import { WeaponPicker } from "./ui/WeaponPicker";

/** Everything one local player picked before joining. */
export interface Loadout {
  characterClass: CharacterClass;
  characterType: CharacterType;
  weaponId: WeaponId;
}

/** What MenuScene hands GameScene via `scene.start("GameScene", config)`. */
export interface LaunchConfig {
  /** null = normal game. */
  debug: DebugConfig | null;
  /** P1's loadout, already chosen in the menu. */
  loadout: Loadout;
}

export const DEFAULT_CHARACTER: CharacterChoice = {
  characterClass: "knight",
  characterType: "guy",
};

export function defaultLoadout(): Loadout {
  return {
    ...DEFAULT_CHARACTER,
    weaponId: CHARACTER_REGISTRY[DEFAULT_CHARACTER.characterClass].defaultWeaponId,
  };
}

const characterPicker = new CharacterPicker();
const weaponPicker = new WeaponPicker();

/**
 * The full join flow for one local player: character, then weapon.
 * Resolves null if either step is cancelled.
 */
export async function pickLoadout(
  playerLabel: string,
  initial: CharacterChoice = DEFAULT_CHARACTER,
): Promise<Loadout | null> {
  const character = await characterPicker.show(playerLabel, initial);
  if (!character) return null;

  const fallback = CHARACTER_REGISTRY[character.characterClass].defaultWeaponId;
  const weaponId = await weaponPicker.show(fallback);
  if (weaponId === null) return null;

  return { ...character, weaponId };
}
