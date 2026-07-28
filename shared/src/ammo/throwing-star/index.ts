import { Ammo } from "../base";

export class ThrowingStar extends Ammo {
  readonly id = "throwing-star";
  readonly name = "Throwing Star";
  get lifetimeMs() { return 900; }
  get spriteAngle() { return 0; }
  get spinDegPerSec() { return 1200; }
}
