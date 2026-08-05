import { Character } from "./base";
import type { CharacterClass } from "./base";
import type { WeaponCategory } from "../weapons/base";

/** Glass cannon: least HP, slowest on foot, and the only class that wields
 *  staves (its elemental bolts, and the reserved nova ability). */
export class Mage extends Character {
  get id(): CharacterClass { return "mage"; }
  get name(): string { return "Mage"; }
  get maxHp(): number { return 60; }
  get speed(): number { return 140; }
  get usableCategories(): readonly WeaponCategory[] {
    return [
      "sword",
      "axe",
      "spear",
      "staff",
    ];
  }
}
