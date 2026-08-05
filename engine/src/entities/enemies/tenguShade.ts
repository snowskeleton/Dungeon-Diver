import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// A Tengu Shade — a small, fragile split-copy the Tengu Mask conjures with its
// Mirror Split (see bosses/TenguMask). It has no ranged tricks of its own: it
// just beelines at the nearest player and batters them on contact, so the split
// is pure pressure the player has to clear. Deliberately NOT in REGULAR_ENEMIES —
// it only ever exists because the boss summoned it.
export class TenguShade extends Enemy {
  static readonly type: EnemyType = "tengu-shade";

  // Glassy: dies fast so the split is a threat you can answer, not a wall. Quick
  // and wide-aggroed so the copies swarm the moment they appear, and they shrug
  // off almost no knockback (a solid hit sends them flying).
  protected get maxHp() { return 28; }
  protected get speed() { return 108; }
  protected get aggroRadius() { return 360; }
  protected get attackRadius() { return 16; }
  protected get attackDamage() { return 8; }
  protected get attackCooldownMs() { return 900; }
  protected get knockbackResistance() { return 0; }
}
