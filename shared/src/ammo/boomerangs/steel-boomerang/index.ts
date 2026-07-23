import { Boomerang } from "../base";

// Steel variant — hits harder, spins faster, longer reach than the wooden one.
export class SteelBoomerang extends Boomerang {
  readonly id = "steel-boomerang";
  readonly name = "Steel Boomerang";
  get damage() { return 20; }
  get speed() { return 330; }
  get lifetimeMs() { return 1500; }
  get knockback() { return 4; }
  get spinDegPerSec() { return 800; }
}
