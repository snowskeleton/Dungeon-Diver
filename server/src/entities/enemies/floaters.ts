import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// Floating eyes, skulls, and a mushroom. All functional placeholders (standard
// chase + melee with default stats) until they're individually tuned.
export class FloatEye extends Enemy { static readonly type: EnemyType = "float-eye"; }
export class FloatSkull extends Enemy { static readonly type: EnemyType = "float-skull"; }
export class FloatSkullTeal extends Enemy { static readonly type: EnemyType = "float-skull-teal"; }
export class FloatSkullPink extends Enemy { static readonly type: EnemyType = "float-skull-pink"; }
export class Smushroom extends Enemy { static readonly type: EnemyType = "smushroom"; }
