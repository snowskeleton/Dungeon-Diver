import { Bolt } from "../base";

// Crystal Wand: the control bolt. Biggest hit and the heaviest knockback in the
// family — a frost impact that shoves enemies off you — paid for with the wand's
// long fire interval (see crystal-wand's attackCooldownMs).
export default new Bolt({
  id: "frost-bolt", name: "Frost Bolt",
  damage: 26,
  speed: 400,
  knockback: 18,
  tint: 0x7fd8ef,
});
