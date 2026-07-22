import { Sword } from "../base";
export class LightningBlade extends Sword {
  readonly id = "lightning-blade";
  readonly name = "Lightning Blade";
  get damage() { return 28; }
}
