import { Bolt } from "../base";

// Ruby Staff: the heavy hitter. Slowest bolt in the family, so the damage comes
// with a real cost — you have to lead your shots. Uses the fireball art directly
// (already fiery), so no tint.
export default new Bolt({
  id: "flame-bolt", name: "Flame Bolt",
  damage: 24,
  speed: 360,
  knockback: 12,
});
