import { Sword } from "../base";
export class GoldBlade extends Sword {
  readonly id = "gold-blade";
  readonly name = "Gold Blade";
  get damage() { return 26; }
}
