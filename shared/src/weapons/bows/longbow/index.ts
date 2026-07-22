import { Bow } from "../base";

// A ranged weapon's `damage` is a flat bonus added to its ammo's damage (see
// docs/weapons-and-ammo.md), so this fires for 25/shot at 550ms ≈ 45 DPS. The
// longbow's role: slower cadence and a bigger per-hit bite than the shortbow,
// only marginally ahead of it on sustained damage.
export class Longbow extends Bow {
  readonly id = "longbow";
  readonly name = "Longbow";
  get damage() { return 10; }
  get attackCooldownMs() { return 550; }
}
