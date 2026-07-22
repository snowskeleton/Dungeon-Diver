import { Dagger } from "../base";
export class CurvedDagger extends Dagger {
  readonly id = "curved-dagger";
  readonly name = "Curved Dagger";
  get damage() { return 17; }
  get attackCooldownMs() { return 280; }
}
