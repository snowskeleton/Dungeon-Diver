import { Bolt } from "../base";

// Ruby Staff: the heavy hitter. Slowest bolt in the family, so the damage comes
// with a real cost — you have to lead your shots. Uses the fireball art directly
// (already fiery), so no tint.
export class FlameBolt extends Bolt {
  readonly id = "flame-bolt";
  readonly name = "Flame Bolt";
  get damage() { return 24; }
  get speed() { return 360; }
  get knockback() { return 12; }
}
