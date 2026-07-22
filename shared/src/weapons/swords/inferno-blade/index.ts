import { Sword } from "../base";
export class InfernoBlade extends Sword {
  readonly id = "inferno-blade";
  readonly name = "Inferno Blade";
  get damage() { return 27; }
}
