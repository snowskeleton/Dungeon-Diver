import { EnemyType, WeaponId } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// A beast that swings a mace with a wind-up.
export class MaceBeast extends ArmedEnemy {
  static readonly type: EnemyType = "mace-beast";
  protected get weaponId(): WeaponId { return "beast-mace"; }
}
