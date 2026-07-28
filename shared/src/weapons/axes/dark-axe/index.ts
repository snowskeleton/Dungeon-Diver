import { Axe } from "../base";
export class DarkAxe extends Axe {
  readonly id = "dark-axe";
  readonly name = "Dark Axe";
  get damage() { return 28; }
}
