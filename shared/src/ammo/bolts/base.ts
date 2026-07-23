import { Ammo, AmmoCategory } from "../base";

// Bolts = the Mage's conjured projectiles, one element per staff. Deliberately a
// separate family from the bosses' fireball/magic-orb: those are tuned SLOW on
// purpose so a player can read and sidestep them (see docs/bosses.md), which is
// the wrong feel for a weapon you fire every ~600ms. Bolts sit between a boss orb
// and an arrow — a touch slower and heavier than an arrow, so magic reads as
// weighty without feeling sluggish.
//
// Orb art is round, so spriteAngle is 0 (nothing to point) and the hitbox is
// near-circular, widened slightly side-to-side like arrows for forgiveness.
// Category base — a concrete bolt overrides only its element's damage/speed/tint.
export abstract class Bolt extends Ammo {
  get category(): AmmoCategory { return "bolts"; }
  get speed() { return 420; }
  get pierce() { return 1; }
  get knockback() { return 8; }
  get lifetimeMs() { return 700; }
  get hitRadiusForward() { return 11; }
  get hitRadiusSide() { return 14; }
  get spriteAngle() { return 0; }
  get damage() { return 15; }
}
