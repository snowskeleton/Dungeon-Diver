import { Mace } from "../base";
export class Club extends Mace {
  readonly id = "club";
  readonly name = "Club";
  get damage() { return 20; }
  get attackCooldownMs() { return 480; }
}
