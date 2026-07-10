import { Thrown } from "../base";

// Long cooldown sells the "wait for it to come back" illusion — the player can't
// throw again until the boomerang has flown out and returned.
export default new Thrown({
  id: "boomerang",
  name: "Boomerang",
  attackCooldownMs: 500,
  ammoId: "boomerang",
});
