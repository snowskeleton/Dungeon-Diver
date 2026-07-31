import { EnemyType, WeaponId } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// A beast that swings a heavy axe with a wind-up.
export class AxeBeast extends ArmedEnemy {
  static readonly type: EnemyType = "axe-beast";
  protected get weaponId(): WeaponId { return "beast-axe"; }
}
