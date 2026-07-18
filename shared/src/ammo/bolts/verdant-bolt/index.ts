import { Bolt } from "../base";

// Emerald Staff: the crowd-clearer. Lower single-target damage, but it punches
// through two enemies — the nature/thorn read. Rewards lining shots up down a
// corridor rather than aiming at one target.
export default new Bolt({
  id: "verdant-bolt", name: "Verdant Bolt",
  damage: 16,
  pierce: 2,
  tint: 0x5fd67a,
});
