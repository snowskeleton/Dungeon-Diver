import { EnemyType } from "shared";
import { DirectionalEnemy } from "./DirectionalEnemy";

// The plain directional chaser — default patrol → chase → contact-melee AI, drawn
// with a row per facing.
export class Bones extends DirectionalEnemy {
  static readonly type: EnemyType = "bones";
}
