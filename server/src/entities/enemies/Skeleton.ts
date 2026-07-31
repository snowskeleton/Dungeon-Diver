import { EnemyType, WeaponId } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// A humanoid enemy drawn from the 15×4 player sheets (it repurposes the skeleton
// skin that used to be a player costume). Swings a real broadsword with a wind-up,
// like the weapon beasts; the humanoid render path (body attack anim + held weapon)
// is wired client-side.
export class Skeleton extends ArmedEnemy {
  static readonly type: EnemyType = "skeleton";
  protected get weaponId(): WeaponId { return "broadsword"; }
}
