import { EnemyFacingMode } from "shared";
import { Enemy } from "../Enemy";

// Enemies drawn with a row per facing (up/right/down/left), so they track all four
// directions and are never mirrored. A thin base that only flips facingMode — the
// plain directional chaser (Bones) extends it. Enemies that are directional AND do
// something special (the fang lunges, the beasts wield weapons) get their directional
// facing another way (a one-line override, or via ArmedEnemy) since TS is single-
// inheritance and they need a different behavior base.
export abstract class DirectionalEnemy extends Enemy {
  protected get facingMode(): EnemyFacingMode { return "directional"; }
}
