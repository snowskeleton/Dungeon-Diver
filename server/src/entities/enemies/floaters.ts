import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// The Smushroom: a grounded creature that releases a lingering damage cloud (see
// its bespoke behaviour). Stats are the defaults until tuned.
export class Smushroom extends Enemy { static readonly type: EnemyType = "smushroom"; }
