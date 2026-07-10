import { Boomerang } from "../base";

// Steel variant — hits harder, spins faster, longer reach than the wooden one.
export default new Boomerang({
  id: "steel-boomerang", name: "Steel Boomerang",
  damage: 20,
  speed: 330,
  lifetimeMs: 1500,
  knockback: 4,
  spinDegPerSec: 800,
});
