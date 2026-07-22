import { Axe } from "../base";
export class Hatchet extends Axe {
  readonly id = "hatchet";
  readonly name = "Hatchet";
  get damage() { return 18; }
  get attackCooldownMs() { return 500; }
}
