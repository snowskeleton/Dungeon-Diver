import { WeaponId } from "../weapons";

export type CharacterType =
  | "guy"
  | "guy-blue"
  | "gal"
  | "gal-green"
  | "skeleton"
  | "skeleton-mage"
  | "colt"
  | "the-fool"
  | "gigante"
  | "reptile"
  | "kobold"
  | "scaleless";
export type CharacterClass = "knight" | "rogue" | "ranger" | "mage";

export interface CharacterConfig {
  id: CharacterClass;
  name: string;
  maxHp: number;
  speed: number;
  defaultWeaponId: WeaponId;
}
