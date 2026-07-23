import { Ammo } from "../base";

// A caster boss's conjured orb (Tengu, Batwing spray). Slow and floaty so a
// player can weave between a fan of them — the bullet-hell-lite feel from
// docs/bosses.md. Team decided at spawn via the projectile's `affects` mask.
export class MagicOrb extends Ammo {
  readonly id = "magic-orb";
  readonly name = "Magic Orb";
  get damage() { return 9; }
  get speed() { return 150; }
  get pierce() { return 1; }
  get knockback() { return 1; }
  get lifetimeMs() { return 3500; }
  get hitRadiusForward() { return 11; }
  get hitRadiusSide() { return 11; }
  get spriteAngle() { return 0; }
}
