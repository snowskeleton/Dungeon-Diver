import { Sword } from "../base";
export class CrystalBlade extends Sword {
  readonly id = "crystal-blade";
  readonly name = "Crystal Blade";
  get damage() { return 25; }
}
