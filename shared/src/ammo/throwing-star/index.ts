import { Ammo } from "../base";

export default new Ammo({
  id: "throwing-star", name: "Throwing Star",
  damage: 11, speed: 320, pierce: 2, knockback: 2,
  lifetimeMs: 900, hitRadiusForward: 10, hitRadiusSide: 10, spriteAngle: 0,
  spinDegPerSec: 1200,
});
