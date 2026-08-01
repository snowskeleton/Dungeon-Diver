import { EnemyType, Weapon, SoldierLance } from "shared";
import { ArmedEnemy } from "./ArmedEnemy";

// An armored soldier that thrusts a lance. The lance out-reaches a sword, so it
// commits to the thrust from further out.
export class ArmorLancer extends ArmedEnemy {
  static readonly type: EnemyType = "armor-lancer";
  protected get weaponTemplate(): Weapon { return new SoldierLance(); }
  protected get attackRange(): number { return 58; }
}
