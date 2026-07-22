import { Spear } from "../base";
export class Javelin extends Spear {
  readonly id = "javelin";
  readonly name = "Javelin";
  get attackCooldownMs() { return 500; }
}
