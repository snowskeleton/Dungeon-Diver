import { Bow } from "../base";
export class Shortbow extends Bow {
  readonly id = "shortbow";
  readonly name = "Shortbow";
  get attackCooldownMs() { return 350; }
  get ammoId() { return "wooden-arrow"; }
}
