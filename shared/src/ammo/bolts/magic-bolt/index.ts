import { Bolt } from "../base";

// The starter bolt (Oak Staff, Cane): plain conjured force, no element. Baseline
// stats — every other bolt trades against these. Untinted; the orb art's own
// colours read as neutral arcane.
export default new Bolt({
  id: "magic-bolt", name: "Magic Bolt",
  damage: 14,
});
