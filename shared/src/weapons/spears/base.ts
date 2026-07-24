import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Straight thrust — 0° offset so the tip points directly at the target.
// Category base — the defaults every spear inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Spear extends Weapon {
  get category(): WeaponCategory { return "spear"; }
  get fxType(): AttackFXType { return "long-stab"; }
  get damage() { return 18; }
  get attackCooldownMs() { return 700; }
  get attackForce() { return 8; }
  // Spear art (spear/lance/javelin/trident) is drawn pointing up-RIGHT at 45°,
  // exactly like the swords/axes/maces — not upright like the hammer. The 0 it
  // used to carry left it held cocked diagonally across the body; -45 stands the
  // shaft up in hand, tip skyward.
  get iconAngle() { return -45; }
}
