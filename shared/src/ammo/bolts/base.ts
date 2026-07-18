import { Ammo, AmmoOverride } from "../base";

// Bolts = the Mage's conjured projectiles, one element per staff. Deliberately a
// separate family from the bosses' fireball/magic-orb: those are tuned SLOW on
// purpose so a player can read and sidestep them (see docs/bosses.md), which is
// the wrong feel for a weapon you fire every ~600ms. Bolts sit between a boss orb
// and an arrow — a touch slower and heavier than an arrow, so magic reads as
// weighty without feeling sluggish.
//
// Orb art is round, so spriteAngle is 0 (nothing to point) and the hitbox is
// near-circular, widened slightly side-to-side like arrows for forgiveness.
const DEFAULTS = {
  category: "bolts" as const,
  speed: 420,
  pierce: 1,
  knockback: 8,
  lifetimeMs: 700,
  hitRadiusForward: 11,
  hitRadiusSide: 14,
  spriteAngle: 0,
  damage: 15,
};

export class Bolt extends Ammo {
  constructor(o: AmmoOverride) { super({ ...DEFAULTS, ...o }); }
}
