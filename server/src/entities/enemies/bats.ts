import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// How high above the floor the eye-bat hovers (px) — the client lifts the sprite
// and drops a shadow. See Enemy.cruiseHeight.
const BAT_HOVER = 16;

// The Eye Bat: a fast, fragile flyer. Placeholder stats + standard chase for now;
// its spiraling movement and dive attack are added in a later step.
export class EyeBat extends Enemy {
  static readonly type: EnemyType = "eye-bat";
  protected get maxHp() { return 30; }
  protected get speed() { return 110; }
  protected get aggroRadius() { return 200; }
  protected get attackRadius() { return 12; }
  protected get attackDamage() { return 8; }
  protected get attackCooldownMs() { return 900; }
  protected get knockbackResistance() { return 0; }
  protected get cruiseHeight() { return BAT_HOVER; }
}
