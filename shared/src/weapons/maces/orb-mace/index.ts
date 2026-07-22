import { Mace } from "../base";
export class OrbMace extends Mace {
  readonly id = "orb-mace";
  readonly name = "Orb Mace";
  get damage() { return 30; }
}
