import { Sword } from "../base";
export class Sabre extends Sword {
  readonly id = "sabre";
  readonly name = "Sabre";
  get attackCooldownMs() { return 420; }
}
