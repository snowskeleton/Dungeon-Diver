import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// The baseline goo — slow, tanky blob. Its stats are exactly the Enemy defaults, so
// it overrides nothing; the other goos tune up from here.
export class GooGreen extends Enemy {
  static readonly type: EnemyType = "goo-green";
  static readonly role = "swarm" as const;
}
