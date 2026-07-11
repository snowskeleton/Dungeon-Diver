import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// Rats, spiders, frog-flowers, and swarms. Functional placeholders (standard
// chase + melee) until tuned; several of these want bespoke behaviour later
// (swarms should move in packs, frog-flowers should be stationary lungers).
export class Rat extends Enemy { static readonly type: EnemyType = "rat"; }
export class Spider extends Enemy { static readonly type: EnemyType = "spider"; }
export class FrogFlower extends Enemy { static readonly type: EnemyType = "frog-flower"; }
export class FrogFlowerBlack extends Enemy { static readonly type: EnemyType = "frog-flower-black"; }
export class Swarm1 extends Enemy { static readonly type: EnemyType = "swarm-1"; }
export class Swarm2 extends Enemy { static readonly type: EnemyType = "swarm-2"; }
export class Swarm3 extends Enemy { static readonly type: EnemyType = "swarm-3"; }
