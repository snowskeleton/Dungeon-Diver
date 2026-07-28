import { Ammo } from "../base";

export class ThrowingKnife extends Ammo {
  readonly id = "throwing-knife";
  readonly name = "Throwing Knife";
  get lifetimeMs() { return 1000; }
  // Flies point-first (no spin). The blade art aims up-right, so spriteAngle -45
  // rotates it to point along the travel direction.
  get spriteAngle() { return -45; }
}
