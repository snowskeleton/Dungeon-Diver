import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// A tougher, harder-hitting goo than the green baseline.
export class GooBlue extends Enemy {
  static readonly type: EnemyType = "goo-blue";
  static readonly role = "swarm" as const;
  protected get maxHp() { return 80; }
  protected get speed() { return 55; }
  protected get aggroRadius() { return 140; }
  protected get attackDamage() { return 14; }
  protected get attackCooldownMs() { return 1400; }
  protected get knockbackResistance() { return 5; }
}
