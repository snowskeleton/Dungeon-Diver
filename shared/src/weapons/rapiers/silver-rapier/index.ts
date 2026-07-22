import { Rapier } from "../base";
export class SilverRapier extends Rapier {
  readonly id = "silver-rapier";
  readonly name = "Silver Rapier";
  get damage() { return 17; }
}
