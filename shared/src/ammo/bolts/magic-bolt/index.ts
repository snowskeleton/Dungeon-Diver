import { Bolt } from "../base";

// The starter bolt (Oak Staff, Cane): plain conjured force, no element. Baseline
// stats — every other bolt trades against these. Untinted; the orb art's own
// colours read as neutral arcane.
export class MagicBolt extends Bolt {
  readonly id = "magic-bolt";
  readonly name = "Magic Bolt";
  get damage() { return 14; }
}
