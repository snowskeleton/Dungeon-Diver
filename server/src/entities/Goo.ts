import { EnemyType, ENEMY_REGISTRY } from "shared";
import { Enemy } from "./Enemy";
import { PhysicsWorld } from "../physics/PhysicsWorld";

export class Goo extends Enemy {
  constructor(physics: PhysicsWorld, { x, y }: { x: number; y: number }, type: EnemyType) {
    super(physics, x, y, ENEMY_REGISTRY[type]);
    this.state.enemyType = type;
  }

  // Directional art has a row per facing, so the base's 4-way tracking is right.
  // Horizontal art only has a side view — never face up/down or the client would
  // have no frame to show.
  protected override updateFacing(dx: number, dy: number): void {
    if (this.cfg.facingMode === "directional") {
      super.updateFacing(dx, dy);
    } else if (dx !== 0) {
      this.state.facing = dx > 0 ? "right" : "left";
    }
  }
}
