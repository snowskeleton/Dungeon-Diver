import { Ammo } from "../base";

export class ThrowingStar extends Ammo {
  readonly id = "throwing-star";
  readonly name = "Throwing Star";
  get damage() { return 11; }
  get speed() { return 320; }
  get pierce() { return 2; }
  get knockback() { return 2; }
  get lifetimeMs() { return 900; }
  get hitRadiusForward() { return 10; }
  get hitRadiusSide() { return 10; }
  get spriteAngle() { return 0; }
  get spinDegPerSec() { return 1200; }
}
