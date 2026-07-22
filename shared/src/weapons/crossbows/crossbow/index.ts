// The plain crossbow shares its name with its category — alias the base class so
// the concrete weapon can still be `Crossbow`.
import { Crossbow as CrossbowBase } from "../base";
export class Crossbow extends CrossbowBase {
  readonly id = "crossbow";
  readonly name = "Crossbow";
}
