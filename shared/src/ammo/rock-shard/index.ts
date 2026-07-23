import { Ammo } from "../base";

// The Turtle Dragon's Tremor Slam shards: jagged rock that juts up from the
// ground in a line radiating outward along a spoke, holds for a beat, then all
// vanish together (see the tremorLine ability in Boss.ts).
//
// This is a pure VISUAL marker — it is spawned `inert`, so it renders and expires
// but carries no hitbox. The whole tremor is ONE consolidated hitbox owned by the
// tremorLine channel (damage/reach/width live there), not 50-odd tiny per-shard
// boxes. So the combat fields below (damage/pierce/hitRadius) are unused for this
// ammo; only the sprite, `speed: 0` (it stands where it erupts), and `fixedAngle`
// (renders upright regardless of its spoke) matter. Lifetime is set per-spawn by
// the ability so a whole staggered cast clears on one tick.
export class RockShard extends Ammo {
  readonly id = "rock-shard";
  readonly name = "Rock Shard";
  get damage() { return 0; }
  get speed() { return 0; }
  get pierce() { return 1; }
  get knockback() { return 0; }
  get lifetimeMs() { return 1200; }
  get hitRadiusForward() { return 8; }
  get hitRadiusSide() { return 8; }
  get spriteAngle() { return 0; }
  get fixedAngle() { return true; }
}
