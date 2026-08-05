import { Character } from "./base";
import type { CharacterClass } from "./base";
import type { WeaponCategory } from "../weapons/base";

/** Fragile skirmisher: fastest on foot, least HP, and the only class that wields
 *  thrown weapons. */
export class Rogue extends Character {
  get id(): CharacterClass { return "rogue"; }
  get name(): string { return "Rogue"; }
  get maxHp(): number { return 70; }
  get speed(): number { return 190; }
  get usableCategories(): readonly WeaponCategory[] {
    return [
      "sword",
      "axe",
      "spear",
      "thrown",
    ];
  }
}
