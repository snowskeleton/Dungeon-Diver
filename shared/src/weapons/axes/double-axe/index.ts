import { Axe } from "../base";
export class DoubleAxe extends Axe {
  readonly id = "double-axe";
  readonly name = "Double Axe";
  get damage() { return 26; }
  get attackCooldownMs() { return 700; }
}
