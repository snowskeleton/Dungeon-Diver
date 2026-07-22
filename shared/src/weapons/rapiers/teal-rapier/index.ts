import { Rapier } from "../base";
export class TealRapier extends Rapier {
  readonly id = "teal-rapier";
  readonly name = "Teal Rapier";
  get attackCooldownMs() { return 300; }
}
