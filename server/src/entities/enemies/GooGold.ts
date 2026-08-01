import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// The toughest goo — high HP, heavy hit, shrugs off most knockback.
export class GooGold extends Enemy {
  static readonly type: EnemyType = "goo-gold";
}
