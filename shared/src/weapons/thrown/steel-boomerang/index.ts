import { Thrown } from "../base";

// Long cooldown sells the "wait for it to come back" illusion — the player can't
// throw again until the boomerang has flown out and returned.
export default new Thrown({
  id: "steel-boomerang",
  name: "Steel Boomerang",
  attackCooldownMs: 1600,
  ammoId: "steel-boomerang",
});
