import { Ammo } from "../base";

// The Turtle Dragon's Tremor Slam cracks: a ground shard that races outward in a
// fixed cardinal/diagonal direction (spawned in a radial burst, not aimed). Fast
// and short-lived so it reads as a crack sprinting a fixed distance then fading,
// leaving the gaps between spokes safe. Placeholder art reuses the fireball
// rock — functional real code until a dedicated crack sprite exists.
// (Team it damages is set at spawn via the projectile's `affects` mask.)
export default new Ammo({
  id: "rock-shard",
  name: "Rock Shard",
  damage: 10,
  speed: 260,
  pierce: 1,
  knockback: 3,
  lifetimeMs: 900,
  hitRadiusForward: 12,
  hitRadiusSide: 14,
  spriteAngle: 0,
});
