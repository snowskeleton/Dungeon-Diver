import { Ammo } from "../base";

export class ThrowingKnife extends Ammo {
  readonly id = "throwing-knife";
  readonly name = "Throwing Knife";
  get damage() { return 13; }
  get speed() { return 300; }
  get pierce() { return 1; }
  get knockback() { return 3; }
  get lifetimeMs() { return 1000; }
  get hitRadiusForward() { return 10; }
  get hitRadiusSide() { return 10; }
  // Flies point-first (no spin). The blade art aims up-right, so spriteAngle -45
  // rotates it to point along the travel direction.
  get spriteAngle() { return -45; }
}
