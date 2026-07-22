import { Staff } from "../base";

// Clean upgrade: a faster, harder-hitting arcane bolt at the baseline fire rate.
export class ArcaneStaff extends Staff {
  readonly id = "arcane-staff";
  readonly name = "Arcane Staff";
  get ammoId() { return "arcane-bolt"; }
}
