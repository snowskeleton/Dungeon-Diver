import { Boomerang as BoomerangBase } from "../base";

// speed (500) and lifetimeMs (500) come from the Boomerang defaults; returnsAtMs
// auto-derives to half the lifetime (250).
export class Boomerang extends BoomerangBase {
  readonly id = "boomerang";
  readonly name = "Boomerang";
  get damage() { return 15; }
}
