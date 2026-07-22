import { Sword } from "../base";
export class GildedSword extends Sword {
  readonly id = "gilded-sword";
  readonly name = "Gilded Sword";
  get damage() { return 23; }
}
