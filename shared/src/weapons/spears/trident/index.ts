import { Spear } from "../base";
export class Trident extends Spear {
  readonly id = "trident";
  readonly name = "Trident";
  get damage() { return 20; }
  get attackForce() { return 9; }
}
