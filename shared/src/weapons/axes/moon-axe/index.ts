import { Axe } from "../base";
export class MoonAxe extends Axe {
  readonly id = "moon-axe";
  readonly name = "Moon Axe";
  get damage() { return 24; }
}
