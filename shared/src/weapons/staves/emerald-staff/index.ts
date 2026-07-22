import { Staff } from "../base";

// Nature: a piercing verdant bolt that punches through two enemies — the
// crowd-clearing staff.
export class EmeraldStaff extends Staff {
  readonly id = "emerald-staff";
  readonly name = "Emerald Staff";
  get ammoId() { return "verdant-bolt"; }
}
