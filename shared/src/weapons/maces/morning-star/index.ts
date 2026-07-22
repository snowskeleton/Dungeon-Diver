import { Mace } from "../base";
export class MorningStar extends Mace {
  readonly id = "morning-star";
  readonly name = "Morning Star";
  get damage() { return 28; }
  get attackForce() { return 14; }
}
