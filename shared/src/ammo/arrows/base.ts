import { Ammo, AmmoCategory } from "../base";

// Arrows point along their travel direction (no spin) and despawn on the first
// wall. Only damage is really per-arrow; speed and everything else fall back to
// these defaults (override speed when it differs). Arrow art points UP, hence
// spriteAngle -90. Category base — a concrete arrow overrides only what differs.
export abstract class Arrow extends Ammo {
  get category(): AmmoCategory { return "arrows"; }
  get speed() { return 500; }
  get pierce() { return 1; }
  get knockback() { return 10; }
  get lifetimeMs() { return 500; }
  // Forward reach stays at the visual arrow length; the side radius is widened so
  // a shot is forgiving left-to-right without reaching an enemy any sooner ahead.
  get hitRadiusForward() { return 10; }
  get hitRadiusSide() { return 18; }
  get spriteAngle() { return -90; }
  get damage() { return 15; }
}
