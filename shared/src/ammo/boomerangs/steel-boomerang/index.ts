import { Boomerang } from "../base";

// Steel variant — hits harder, spins faster, longer reach than the wooden one.
export class SteelBoomerang extends Boomerang {
  readonly id = "steel-boomerang";
  readonly name = "Steel Boomerang";
  get lifetimeMs() { return 1500; }
  get spinDegPerSec() { return 800; }
}
