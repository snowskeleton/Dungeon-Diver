import { Weapon, WeaponCategory, AttackFXType } from "../base";

// Heavy overhead swing — same arc tilt as swords/axes.
// Category base — the defaults every hammer inherits; a concrete
// weapon overrides only what makes it distinct.
export abstract class Hammer extends Weapon {
  get category(): WeaponCategory { return "hammer"; }
  get fxType(): AttackFXType { return "slash"; }
  get damage() { return 35; }
  get attackCooldownMs() { return 800; }
  get attackForce() { return 15; }
  // The hammer art is drawn already upright (handle down, head up), unlike the
  // swords/axes/maces whose blades point up-RIGHT at 45°. So it needs no
  // corrective tilt — 0 leaves it resting head-up like a shouldered sword;
  // the -45 the other slash weapons use would cock it sideways.
  get iconAngle() { return 0; }
}
