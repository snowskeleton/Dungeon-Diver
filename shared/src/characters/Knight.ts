import { Character } from "./base";
import type { CharacterClass } from "./base";
import type { WeaponCategory } from "../weapons/base";

/** Tanky melee bruiser: most HP, average speed, and the only class that wields
 *  hammers and maces. */
export class Knight extends Character {
  get id(): CharacterClass { return "knight"; }
  get name(): string { return "Knight"; }
  get maxHp(): number { return 100; }
  get speed(): number { return 156; }
  get usableCategories(): readonly WeaponCategory[] {
    return [
      "sword",
      "axe",
      "spear",
      "rapier",
      "hammer",
      "mace",
    ];
  }
}
