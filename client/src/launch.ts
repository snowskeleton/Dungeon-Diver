import { CharacterClass, CharacterType } from "shared";
import { CharacterPicker, CharacterChoice } from "./ui/CharacterPicker";

/** Everything one player picked: who they are. Players no longer choose a starting
 *  weapon — the first weapon is claimed from a floor-1 supply-room pedestal. */
export interface Loadout {
  characterClass: CharacterClass;
  characterType: CharacterType;
}

export const DEFAULT_CHARACTER: CharacterChoice = {
  characterClass: "knight",
  characterType: "guy",
};

export function defaultLoadout(): Loadout {
  return { ...DEFAULT_CHARACTER };
}

const characterPicker = new CharacterPicker();

/**
 * The pick flow for one player: character + skin only. Resolves null if cancelled.
 *
 * This is no longer a gate in front of the game — it runs from the LOBBY, on a
 * player who already exists and already has a loadout, which is why it takes the
 * current one and pre-selects it. There is no weapon step anymore: the first
 * weapon comes from the supply room, rolled from the class's own categories.
 */
export async function pickLoadout(
  playerLabel: string,
  initial: Loadout = defaultLoadout(),
): Promise<Loadout | null> {
  const character = await characterPicker.show(playerLabel, initial);
  if (!character) return null;
  return { ...character };
}
