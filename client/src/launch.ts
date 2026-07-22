import { CHARACTER_REGISTRY, CharacterClass, CharacterType, WeaponId } from "shared";
import { CharacterPicker, CharacterChoice } from "./ui/CharacterPicker";
import { WeaponPicker } from "./ui/WeaponPicker";

/** Everything one player picked: who they are and what they're holding. */
export interface Loadout {
  characterClass: CharacterClass;
  characterType: CharacterType;
  weaponId: WeaponId;
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
 * The pick flow for one player: character, then weapon. Resolves null if either
 * step is cancelled.
 *
 * This is no longer a gate in front of the game — it runs from the LOBBY, on a
 * player who already exists and already has a loadout, which is why it takes the
 * current one and pre-selects it. Keeping the weapon across a class change would
 * be wrong, though: the point of switching to Mage is the staff, so a class
 * change falls back to that class's own starting weapon.
 */
export async function pickLoadout(
  playerLabel: string,
  initial: Loadout = defaultLoadout(),
): Promise<Loadout | null> {
  const character = await characterPicker.show(playerLabel, initial);
  if (!character) return null;

  const classDefault = CHARACTER_REGISTRY[character.characterClass].defaultWeaponId;
  const preselect = character.characterClass === initial.characterClass
    ? initial.weaponId
    : classDefault;
  const weaponId = await weaponPicker.show(preselect);
  if (weaponId === null) return null;

  return { ...character, weaponId };
}
