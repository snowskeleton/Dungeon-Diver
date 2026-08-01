import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// A tougher, harder-hitting goo than the green baseline.
export class GooBlue extends Enemy {
  static readonly type: EnemyType = "goo-blue";
}
