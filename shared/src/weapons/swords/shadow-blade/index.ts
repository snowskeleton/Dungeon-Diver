import { Sword } from "../base";
export class ShadowBlade extends Sword {
  readonly id = "shadow-blade";
  readonly name = "Shadow Blade";
  get damage() { return 26; }
}
