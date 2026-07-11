import { Ammo } from "../base";

// A caster boss's conjured orb (Tengu, Batwing spray). Slow and floaty so a
// player can weave between a fan of them — the bullet-hell-lite feel from
// docs/bosses.md. Team decided at spawn via the projectile's `affects` mask.
export default new Ammo({
  id: "magic-orb", name: "Magic Orb",
  damage: 9, speed: 150, pierce: 1, knockback: 1,
  lifetimeMs: 3500, hitRadiusForward: 11, hitRadiusSide: 11,
  spriteAngle: 0,
});
