import { Ammo } from "../base";

// The Turtle Dragon's Boulder Belch: a chunky rock it lobs in a spread while it
// holds ground. Slower and heavier-hitting than a fireball — a big, readable
// rock that tumbles in flight (spin, not aimed) so it reads as a
// thrown boulder rather than a darted shot. Slow enough to sidestep the arc; the
// knockback is the punish for eating one. The team it damages is set at spawn via
// the projectile's `affects` mask (see docs/layers.md).
export class Boulder extends Ammo {
  readonly id = "boulder";
  readonly name = "Boulder";
  get damage() { return 14; }
  get speed() { return 150; }
  get pierce() { return 1; }
  get knockback() { return 5; }
  get lifetimeMs() { return 3000; }
  get hitRadiusForward() { return 13; }
  get hitRadiusSide() { return 13; }
  get spriteAngle() { return 0; }
  get spinDegPerSec() { return 160; }
}
