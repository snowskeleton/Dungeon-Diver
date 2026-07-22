import { Thrown } from "../base";
export class ThrowingKnife extends Thrown {
  readonly id = "throwing-knife";
  readonly name = "Throwing Knife";
  get ammoId() { return "throwing-knife"; }
}
