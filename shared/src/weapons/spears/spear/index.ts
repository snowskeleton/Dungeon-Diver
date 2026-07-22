// The plain spear shares its name with its category — alias the base class so the
// concrete weapon can still be `Spear`.
import { Spear as SpearBase } from "../base";
export class Spear extends SpearBase {
  readonly id = "spear";
  readonly name = "Spear";
}
