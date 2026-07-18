import { Bow } from "../base";

// A ranged weapon's `damage` is a flat bonus added to its ammo's damage (see
// docs/weapons-and-ammo.md). This was 24 back when it was inert, which would now
// put the longbow at 39/shot ≈ 71 DPS against the shortbow's 43 — so it's retuned
// to the role it was always meant to play: slower cadence, bigger per-hit bite,
// marginally ahead on sustained damage. 25/shot at 550ms ≈ 45 DPS.
export default new Bow({
  id: "longbow",
  name: "Longbow",
  damage: 10,
  attackCooldownMs: 550,
});
