import { EnemyType, EnemyFacingMode, WeaponId } from "shared";
import { Enemy } from "../Enemy";
import { ArmedEnemy } from "./armed";

// Enemies drawn with a row per facing (up/right/down/left), so they track all
// four directions and are never mirrored. Shared here as a base so each one only
// declares its id. Bones and Fang are the plain chasers (Fang keeps contact until
// its fang-lash art lands); the beasts and the armor-lancer WIELD WEAPONS and swing
// them with a wind-up (see ArmedEnemy).
abstract class DirectionalEnemy extends Enemy {
  protected get facingMode(): EnemyFacingMode { return "directional"; }
}

export class Bones extends DirectionalEnemy { static readonly type: EnemyType = "bones"; }
export class Fang extends DirectionalEnemy { static readonly type: EnemyType = "fang"; }

export class SwordBeast extends ArmedEnemy {
  static readonly type: EnemyType = "sword-beast";
  protected get weaponId(): WeaponId { return "broadsword"; }
}
export class AxeBeast extends ArmedEnemy {
  static readonly type: EnemyType = "axe-beast";
  protected get weaponId(): WeaponId { return "war-axe"; }
}
export class MaceBeast extends ArmedEnemy {
  static readonly type: EnemyType = "mace-beast";
  protected get weaponId(): WeaponId { return "club"; }
}
export class ArmorLancer extends ArmedEnemy {
  static readonly type: EnemyType = "armor-lancer";
  protected get weaponId(): WeaponId { return "lance"; }
  // The lance out-reaches a sword, so commit to the thrust from further out.
  protected get attackRange(): number { return 58; }
}
