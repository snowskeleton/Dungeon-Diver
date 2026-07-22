import { Axe } from "../base";
export class WarAxe extends Axe {
  readonly id = "war-axe";
  readonly name = "War Axe";
  get damage() { return 25; }
}
