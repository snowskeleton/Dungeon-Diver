import { Ammo } from "../base";

// The Turtle Dragon's Boulder Belch: a chunky rock it lobs in a spread while it
// holds ground. Slower and heavier-hitting than the fireball it used to borrow —
// a big, readable rock that tumbles in flight (spin, not aimed) so it reads as a
// thrown boulder rather than a darted shot. Slow enough to sidestep the arc; the
// knockback is the punish for eating one. The team it damages is set at spawn via
// the projectile's `affects` mask (see docs/layers.md).
export default new Ammo({
  id: "boulder",
  name: "Boulder",
  damage: 14,
  speed: 150,
  pierce: 1,
  knockback: 5,
  lifetimeMs: 3000,
  hitRadiusForward: 13,
  hitRadiusSide: 13,
  spriteAngle: 0,
  spinDegPerSec: 160,
});
