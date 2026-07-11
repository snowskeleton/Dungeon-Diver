import { EnemyType, EnemyFacingMode } from "shared";
import { Enemy } from "../Enemy";

// Enemies drawn with a row per facing (up/right/down/left), so they track all
// four directions and are never mirrored. Shared here as a base so each one only
// declares its id — behaviour is still the standard chase + melee for now.
abstract class DirectionalEnemy extends Enemy {
  protected get facingMode(): EnemyFacingMode { return "directional"; }
}

export class Bones extends DirectionalEnemy { static readonly type: EnemyType = "bones"; }
export class BonesBlader extends DirectionalEnemy { static readonly type: EnemyType = "bones-blader"; }
export class Kultist extends DirectionalEnemy { static readonly type: EnemyType = "kultist"; }
export class ArmorLancer extends DirectionalEnemy { static readonly type: EnemyType = "armor-lancer"; }
export class Beast extends DirectionalEnemy { static readonly type: EnemyType = "beast"; }
export class AxeBeast extends DirectionalEnemy { static readonly type: EnemyType = "axe-beast"; }
export class MaceBeast extends DirectionalEnemy { static readonly type: EnemyType = "mace-beast"; }
export class SwordBeast extends DirectionalEnemy { static readonly type: EnemyType = "sword-beast"; }
export class Fang extends DirectionalEnemy { static readonly type: EnemyType = "fang"; }
export class HoodFang extends DirectionalEnemy { static readonly type: EnemyType = "hood-fang"; }
