import { Thrown } from "../base";
export class ThrowingKnife extends Thrown {
  readonly id = "throwing-knife";
  readonly name = "Throwing Knife";
  get attackCooldownMs() { return 400; }
  get ammoId() { return "throwing-knife"; }
}
