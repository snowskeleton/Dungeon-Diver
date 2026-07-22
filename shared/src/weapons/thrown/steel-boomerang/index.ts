import { Thrown } from "../base";

// Long cooldown sells the "wait for it to come back" illusion — the player can't
// throw again until the boomerang has flown out and returned.
export class SteelBoomerang extends Thrown {
  readonly id = "steel-boomerang";
  readonly name = "Steel Boomerang";
  get attackCooldownMs() { return 1600; }
  get ammoId() { return "steel-boomerang"; }
}
