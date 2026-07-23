import { Bolt } from "../base";

// Emerald Staff: the crowd-clearer. Lower single-target damage, but it punches
// through two enemies — the nature/thorn read. Rewards lining shots up down a
// corridor rather than aiming at one target.
export class VerdantBolt extends Bolt {
  readonly id = "verdant-bolt";
  readonly name = "Verdant Bolt";
  get damage() { return 16; }
  get pierce() { return 2; }
  get tint() { return 0x5fd67a; }
}
