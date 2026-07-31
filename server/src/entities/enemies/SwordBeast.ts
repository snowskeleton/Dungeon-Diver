import { EnemyType, WeaponId } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// A beast that swings a real broadsword-class blade with a wind-up.
export class SwordBeast extends ArmedEnemy {
  static readonly type: EnemyType = "sword-beast";
  protected get weaponId(): WeaponId { return "beast-sword"; }
}
