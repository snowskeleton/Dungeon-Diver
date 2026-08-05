import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// The toughest goo — high HP, heavy hit, shrugs off most knockback.
export class GooGold extends Enemy {
  static readonly type: EnemyType = "goo-gold";
  protected get maxHp() { return 100; }
  protected get speed() { return 60; }
  protected get aggroRadius() { return 180; }
  protected get attackDamage() { return 18; }
  protected get attackCooldownMs() { return 1000; }
  protected get knockbackResistance() { return 8; }
}
