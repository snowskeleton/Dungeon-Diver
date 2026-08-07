import { EnemyType, Weapon, BeastMace } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// A beast that swings a mace with a wind-up — the heaviest beast swing: the longest
// telegraph and the slowest cadence, in exchange for the mace's higher force.
export class MaceBeast extends ArmedEnemy {
  static readonly type: EnemyType = "mace-beast";
  static readonly role = "brute" as const;
  static readonly threat = 3;
  protected get weaponTemplate(): Weapon { return new BeastMace(); }
  protected get windUpMs() { return 700; }
  protected get attackCooldownMs() { return 1900; }
}
