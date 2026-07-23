import { Arrow } from "../base";
export class PiercingArrow extends Arrow {
  readonly id = "piercing-arrow";
  readonly name = "Piercing Arrow";
  get pierce() { return 3; }
}
