import { Sword } from "../base";
export class WoodenSword extends Sword {
  readonly id = "wood-sword";
  readonly name = "Wooden Sword";
  get damage() { return 12; }
  get attackCooldownMs() { return 450; }
}
