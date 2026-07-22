import { Spear } from "../base";
export class Lance extends Spear {
  readonly id = "lance";
  readonly name = "Lance";
  get damage() { return 22; }
}
