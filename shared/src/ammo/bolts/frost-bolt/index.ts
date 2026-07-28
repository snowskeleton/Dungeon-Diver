import { Bolt } from "../base";

// Crystal Wand: the control bolt. Biggest hit and the heaviest knockback in the
// family — a frost impact that shoves enemies off you — paid for with the wand's
// long fire interval (see crystal-wand's attackCooldownMs).
export class FrostBolt extends Bolt {
  readonly id = "frost-bolt";
  readonly name = "Frost Bolt";
  get tint() { return 0x7fd8ef; }
}
