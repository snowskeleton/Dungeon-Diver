import { Sword } from "../base";
export class CrimsonBlade extends Sword {
  readonly id = "crimson-blade";
  readonly name = "Crimson Blade";
  get damage() { return 24; }
}
