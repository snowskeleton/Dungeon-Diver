import { EnemyType, Weapon, BeastSword } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// A beast that swings a real broadsword-class blade with a wind-up.
export class SwordBeast extends ArmedEnemy {
  static readonly type: EnemyType = "sword-beast";
  static readonly role = "brute" as const;
  static readonly threat = 2;
  protected get weaponTemplate(): Weapon { return new BeastSword(); }
}
