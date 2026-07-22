import { Staff } from "../base";

// Frost: the biggest hit and heaviest knockback in the family, paid for with the
// slowest fire interval of any staff.
export class CrystalWand extends Staff {
  readonly id = "crystal-wand";
  readonly name = "Crystal Wand";
  get ammoId() { return "frost-bolt"; }
  get attackCooldownMs() { return 760; }
}
