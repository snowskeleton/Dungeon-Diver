import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// A Tengu Shade — a small, fragile split-copy the Tengu Mask conjures with its
// Mirror Split (see bosses/TenguMask). It has no ranged tricks of its own: it
// just beelines at the nearest player and batters them on contact, so the split
// is pure pressure the player has to clear. Deliberately NOT in REGULAR_ENEMIES —
// it only ever exists because the boss summoned it.
export class TenguShade extends Enemy {
  static readonly type: EnemyType = "tengu-shade";
}
