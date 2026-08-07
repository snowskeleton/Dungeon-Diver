import { EnemyType, Weapon, SkeletonStaff } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// The skeleton-mage — the first RANGED rank-and-file enemy. It wields a staff and
// fires magic bolts (weaponSpell resolves the staff's ammo into a shot), so it
// commits from well outside melee range instead of walking in to touch you.
export class SkeletonMage extends ArmedEnemy {
  static readonly type: EnemyType = "skeleton-mage";
  static readonly role = "ranged" as const;
  static readonly threat = 2;
  protected get weaponTemplate(): Weapon { return new SkeletonStaff(); }
  // Fire from range: commit to a cast whenever a player is within bolt reach,
  // rather than closing to a sword's length first.
  protected get attackRange(): number { return 220; }
  // A long, visible charge before each bolt (the staff itself telegraphs in 0ms —
  // it auto-fires for a player) so a bolt is dodgeable, then a slow cadence so it
  // punctuates a fight instead of streaming. Both are the enemy's dials now; the
  // staff supplies only the bolt.
  protected get windUpMs() { return 700; }
  protected get attackCooldownMs() { return 2500; }
}
