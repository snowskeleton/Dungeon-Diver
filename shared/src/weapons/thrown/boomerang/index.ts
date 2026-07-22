import { Thrown } from "../base";

// Long cooldown sells the "wait for it to come back" illusion — the player can't
// throw again until the boomerang has flown out and returned.
export class Boomerang extends Thrown {
  readonly id = "boomerang";
  readonly name = "Boomerang";
  get attackCooldownMs() { return 500; }
  get ammoId() { return "boomerang"; }
}
