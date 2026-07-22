import { Mace } from "../base";
export class Flail extends Mace {
  readonly id = "flail";
  readonly name = "Flail";
  get damage() { return 27; }
  get attackForce() { return 13; }
}
