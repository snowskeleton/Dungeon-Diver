import { EnemyType, WeaponId } from "shared";
import { ArmedEnemy } from "./armed";

// The humanoid enemies — the first rabble drawn from the 15×4 player sheets
// (HUMANOID_SKINS). They repurpose the skeleton / skeleton-mage skins that used to
// be player costumes. Both are ArmedEnemies: the skeleton swings a real broadsword,
// the mage casts a staff bolt. The humanoid render path (body attack anim + held
// weapon) is wired client-side; here they're ordinary armed enemies.

/** Skeleton — swings a broadsword with a wind-up, like the weapon beasts. */
export class Skeleton extends ArmedEnemy {
  static readonly type: EnemyType = "skeleton";
  protected get weaponId(): WeaponId { return "broadsword"; }
}

/** Skeleton-mage — the first RANGED rank-and-file enemy. It wields a staff and
 *  fires magic bolts (weaponSpell resolves the staff's ammo into a shot), so it
 *  commits from well outside melee range instead of walking in to touch you. */
export class SkeletonMage extends ArmedEnemy {
  static readonly type: EnemyType = "skeleton-mage";
  protected get weaponId(): WeaponId { return "oak-staff"; }
  // Fire from range: commit to a cast whenever a player is within bolt reach,
  // rather than closing to a sword's length first.
  protected get attackRange(): number { return 220; }
  // A shorter beat between bolts than a heavy melee swing's recovery.
  protected get attackRestMs(): number { return 500; }
}
