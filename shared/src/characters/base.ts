import { WeaponId } from "../weapons";

export type CharacterType = "guy" | "gal" | "skeleton" | "skeleton-mage";
export type CharacterClass = "knight" | "rogue" | "ranger" | "mage";

export interface CharacterConfig {
  id: CharacterClass;
  name: string;
  maxHp: number;
  speed: number;
  defaultWeaponId: WeaponId;
}
