import { EnemyType, Weapon, BeastAxe } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// A beast that swings a heavy axe with a wind-up. Heavier than the sword-beast, so
// it rears back longer and swings less often.
export class AxeBeast extends ArmedEnemy {
  static readonly type: EnemyType = "axe-beast";
  static readonly role = "brute" as const;
  static readonly threat = 3;
  protected get weaponTemplate(): Weapon { return new BeastAxe(); }
  protected get windUpMs() { return 600; }
  protected get attackCooldownMs() { return 1700; }
}
