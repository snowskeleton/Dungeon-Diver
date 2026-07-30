import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// Spiders and frog-flowers. The spider is a standard chaser; the frog-flower has
// bespoke hop-and-leap behaviour (see FrogFlower below).
export class Spider extends Enemy { static readonly type: EnemyType = "spider"; }
export class FrogFlower extends Enemy { static readonly type: EnemyType = "frog-flower"; }
