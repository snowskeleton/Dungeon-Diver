import { Sword } from "../base";
export class FrostBlade extends Sword {
  readonly id = "frost-blade";
  readonly name = "Frost Blade";
  get damage() { return 24; }
}
