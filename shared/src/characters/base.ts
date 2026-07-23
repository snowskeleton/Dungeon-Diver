import { WeaponId } from "../weapons";

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
  defaultWeaponId: WeaponId;
}
