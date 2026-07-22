import { Staff } from "../base";

// Fire: a slow, heavy flame bolt on a slower fire interval — big hits, low cadence.
export class RubyStaff extends Staff {
  readonly id = "ruby-staff";
  readonly name = "Ruby Staff";
  get ammoId() { return "flame-bolt"; }
  get attackCooldownMs() { return 620; }
}
