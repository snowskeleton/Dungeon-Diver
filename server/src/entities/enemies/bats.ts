import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// How high above the floor the bats hover (px) — the client lifts the sprite and
// drops a shadow. See Enemy.cruiseHeight.
const BAT_HOVER = 16;

// Fast, fragile flyers. Only the Bat is tuned so far; the rest are functional
// placeholders (standard chase + melee) until they're balanced.
export class Bat extends Enemy {
  static readonly type: EnemyType = "bat";
  protected get maxHp() { return 30; }
  protected get speed() { return 110; }
  protected get aggroRadius() { return 200; }
  protected get attackRadius() { return 12; }
  protected get attackDamage() { return 8; }
  protected get attackCooldownMs() { return 900; }
  protected get knockbackResistance() { return 0; }
  protected get cruiseHeight() { return BAT_HOVER; }
}

export class BrownBat extends Enemy { static readonly type: EnemyType = "brown-bat"; protected get cruiseHeight() { return BAT_HOVER; } }
export class EyeBat extends Enemy { static readonly type: EnemyType = "eye-bat"; protected get cruiseHeight() { return BAT_HOVER; } }
export class GoldEye extends Enemy { static readonly type: EnemyType = "gold-eye"; protected get cruiseHeight() { return BAT_HOVER; } }
