import { EnemyType, ENEMY_REGISTRY } from "shared";
import { Enemy } from "./Enemy";
import { PhysicsWorld } from "../physics/PhysicsWorld";

export class Goo extends Enemy {
  constructor(physics: PhysicsWorld, { x, y }: { x: number; y: number }, type: EnemyType) {
    super(physics, x, y, ENEMY_REGISTRY[type]);
    this.state.enemyType = type;
  }

  // Goo sprites only have horizontal art — only track left/right facing.
  protected override updateFacing(dx: number, dy: number): void {
    if (Math.abs(dx) > 0) {
      this.state.facing = dx > 0 ? "right" : "left";
    }
  }
}
