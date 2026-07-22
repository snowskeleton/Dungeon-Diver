import { Sword } from "../base";
export class Stiletto extends Sword {
  readonly id = "stiletto";
  readonly name = "Stiletto";
  get attackCooldownMs() { return 400; }
}
