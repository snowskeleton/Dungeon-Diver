import { Sword } from "../base";
export class Flamberge extends Sword {
  readonly id = "flamberge";
  readonly name = "Flamberge";
  get damage() { return 22; }
}
