import { Ammo } from "../base";

// A boss's fire-breath projectile. Deliberately slow (≈half an arrow's speed)
// so a player can read it and sidestep — bosses telegraph, then throw dodgeable
// shots (see docs/bosses.md). The team it damages is decided at spawn time via
// the projectile's `affects` mask, not here (see docs/layers.md).
export class Fireball extends Ammo {
  readonly id = "fireball";
  readonly name = "Fireball";
  get lifetimeMs() { return 3000; }
  get spriteAngle() { return 0; }
}
