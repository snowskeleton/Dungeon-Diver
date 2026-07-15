import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// How high the floating eyes/skulls hover (px); the client lifts them and draws a
// shadow. See Enemy.cruiseHeight. The Smushroom is grounded, so it stays at 0.
const FLOAT_HOVER = 12;

// Floating eyes, skulls, and a mushroom. All functional placeholders (standard
// chase + melee with default stats) until they're individually tuned.
export class FloatEye extends Enemy { static readonly type: EnemyType = "float-eye"; protected get cruiseHeight() { return FLOAT_HOVER; } }
export class FloatSkull extends Enemy { static readonly type: EnemyType = "float-skull"; protected get cruiseHeight() { return FLOAT_HOVER; } }
export class FloatSkullTeal extends Enemy { static readonly type: EnemyType = "float-skull-teal"; protected get cruiseHeight() { return FLOAT_HOVER; } }
export class FloatSkullPink extends Enemy { static readonly type: EnemyType = "float-skull-pink"; protected get cruiseHeight() { return FLOAT_HOVER; } }
export class Smushroom extends Enemy { static readonly type: EnemyType = "smushroom"; }
