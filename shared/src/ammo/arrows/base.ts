import { Ammo, AmmoOverride } from "../base";

// Arrows point along their travel direction (no spin) and despawn on the first
// wall. Only damage is really per-arrow; speed and everything else fall back to
// these defaults (override speed when it differs). Arrow art points UP, hence
// spriteAngle -90.
const DEFAULTS = {
  category: "arrows" as const,
  speed: 500,
  pierce: 1,
  knockback: 10,
  lifetimeMs: 500,
  // Forward reach stays at the visual arrow length; the side radius is widened so
  // a shot is forgiving left-to-right without reaching an enemy any sooner ahead.
  hitRadiusForward: 10,
  hitRadiusSide: 18,
  spriteAngle: -90,
  damage: 15,
};

export class Arrow extends Ammo {
  constructor(o: AmmoOverride) { super({ ...DEFAULTS, ...o }); }
}
