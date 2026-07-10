import { Ammo } from "../base";

export default new Ammo({
  id: "throwing-knife", name: "Throwing Knife",
  damage: 13, speed: 300, pierce: 1, knockback: 3,
  // Flies point-first (no spin). The blade art aims up-right, so spriteAngle -45
  // rotates it to point along the travel direction.
  lifetimeMs: 1000, hitRadiusForward: 10, hitRadiusSide: 10, spriteAngle: -45,
});
