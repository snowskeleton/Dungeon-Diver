import { Character } from "./base";
import type { CharacterClass } from "./base";
import type { WeaponCategory } from "../weapons/base";

/** Ranged specialist: middling HP and speed, and the only class that wields
 *  bows. */
export class Ranger extends Character {
  get id(): CharacterClass { return "ranger"; }
  get name(): string { return "Ranger"; }
  get maxHp(): number { return 80; }
  get speed(): number { return 170; }
  get usableCategories(): readonly WeaponCategory[] {
    return [
      "sword",
      "axe",
      "spear",
      "bow",
    ];
  }
}
