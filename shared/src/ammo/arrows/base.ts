import { Ammo, AmmoCategory } from "../base";

// Arrows point along their travel direction (no spin) and despawn on the first
// wall. Only damage is really per-arrow; speed and everything else fall back to
// these defaults (override speed when it differs). Arrow art points UP, hence
// spriteAngle -90. Category base — a concrete arrow overrides only what differs.
export abstract class Arrow extends Ammo {
  get category(): AmmoCategory { return "arrows"; }
  get spriteAngle() { return -90; }
}
