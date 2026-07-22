import { Sword } from "../base";
export class MysticBlade extends Sword {
  readonly id = "mystic-blade";
  readonly name = "Mystic Blade";
  get damage() { return 28; }
}
