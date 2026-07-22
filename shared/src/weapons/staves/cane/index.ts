import { Staff } from "../base";

// Fires the same starter bolt as the Oak Staff but noticeably faster — the
// low-damage, high-cadence option.
export class Cane extends Staff {
  readonly id = "cane";
  readonly name = "Cane";
  get attackCooldownMs() { return 440; }
}
