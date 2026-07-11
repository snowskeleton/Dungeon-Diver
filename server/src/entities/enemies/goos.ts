import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// The goos — slow, tanky blobs. GooGreen is the baseline: its stats are exactly
// the Enemy defaults, so it overrides nothing.
export class GooGreen extends Enemy {
  static readonly type: EnemyType = "goo-green";
}

export class GooBlue extends Enemy {
  static readonly type: EnemyType = "goo-blue";
  protected get maxHp() { return 80; }
  protected get speed() { return 55; }
  protected get aggroRadius() { return 140; }
  protected get attackDamage() { return 14; }
  protected get attackCooldownMs() { return 1400; }
  protected get knockbackResistance() { return 5; }
}

export class GooGold extends Enemy {
  static readonly type: EnemyType = "goo-gold";
  protected get maxHp() { return 100; }
  protected get speed() { return 60; }
  protected get aggroRadius() { return 180; }
  protected get attackDamage() { return 18; }
  protected get attackCooldownMs() { return 1000; }
  protected get knockbackResistance() { return 8; }
}
