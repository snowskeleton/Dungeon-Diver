import { Ammo } from "../base";

// A boss's fire-breath projectile. Deliberately slow (≈half an arrow's speed)
// so a player can read it and sidestep — bosses telegraph, then throw dodgeable
// shots (see docs/bosses.md). The team it damages is decided at spawn time via
// the projectile's `affects` mask, not here (see docs/layers.md).
export default new Ammo({
  id: "fireball", name: "Fireball",
  damage: 12, speed: 170, pierce: 1, knockback: 2,
  lifetimeMs: 3000, hitRadiusForward: 12, hitRadiusSide: 12,
  spriteAngle: 0,
});
