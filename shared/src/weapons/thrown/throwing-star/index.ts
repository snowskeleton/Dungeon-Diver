import { Thrown } from "../base";
export class ThrowingStar extends Thrown {
  readonly id = "throwing-star";
  readonly name = "Throwing Star";
  get ammoId() { return "throwing-star"; }
}
