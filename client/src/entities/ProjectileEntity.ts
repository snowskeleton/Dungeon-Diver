import Phaser from "phaser";
import { AMMO_REGISTRY, AmmoConfig } from "shared";
import { DebugDrawable, DebugShape, DEBUG_COLORS } from "../debug/DebugDraw";

// Renders a server-authoritative projectile (arrow). Lightweight — no HP bar,
// doesn't extend Entity. Lerps toward the server position and rotates the sprite
// to point along its travel angle (state.angle) using the ammo's baked
// spriteAngle (arrow art points up, so spriteAngle = -90).
export class ProjectileEntity implements DebugDrawable {
  private sprite: Phaser.GameObjects.Sprite;
  private targetX: number;
  private targetY: number;
  private readonly spriteAngle: number;
  private readonly spinDegPerSec: number;
  private readonly fixedAngle: boolean;
  private readonly ammo?: AmmoConfig;
  private travelAngle: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    angleRad: number,
    ammoId: string,
  ) {
    const ammo = AMMO_REGISTRY[ammoId];
    const textureKey = ammo ? ammoId : "arrow";
    this.ammo = ammo;
    this.spriteAngle = ammo?.spriteAngle ?? -90;
    this.spinDegPerSec = ammo?.spinDegPerSec ?? 0;
    this.fixedAngle = ammo?.fixedAngle ?? false;
    this.targetX = x;
    this.targetY = y;
    this.travelAngle = angleRad;

    this.sprite = scene.add.sprite(x, y, textureKey);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setDepth(2.7);
    this.sprite.setDisplaySize(24, 24);
    this.setAngleFromTravel(angleRad);
  }

  private setAngleFromTravel(angleRad: number) {
    // Spinning projectiles (thrown weapons) aren't aimed — their update() spins
    // the sprite freely, so don't fight it here.
    if (this.spinDegPerSec > 0) return;
    // Ground hazards (tremor shards) rise in place and don't aim along travel —
    // keep the art at its drawn orientation regardless of which way it radiates.
    if (this.fixedAngle) {
      this.sprite.setAngle(0);
      return;
    }
    const deg = Phaser.Math.RadToDeg(angleRad);
    // Sprite art points "up"; rotating by (travel − spriteAngle) aims it along travel.
    this.sprite.setAngle(deg - this.spriteAngle);
  }

  setTarget(x: number, y: number, angleRad: number) {
    this.targetX = x;
    this.targetY = y;
    this.travelAngle = angleRad;
    this.setAngleFromTravel(angleRad);
  }

  update() {
    // Light lerp to smooth the 20Hz server updates without visible lag;
    // projectiles are fast so we track tightly.
    this.sprite.x += (this.targetX - this.sprite.x) * 0.5;
    this.sprite.y += (this.targetY - this.sprite.y) * 0.5;
    // Spin thrown weapons (assumes ~60fps; purely cosmetic).
    if (this.spinDegPerSec > 0) {
      this.sprite.angle += this.spinDegPerSec / 60;
    }
  }

  collectDebugShapes(): DebugShape[] {
    if (!this.ammo) return [];
    // The server's hit test is an ellipse in the projectile's travel frame:
    // rx = reach along travel, ry = width across it (see Projectile.tryHit).
    return [
      {
        kind: "ellipse",
        x: this.sprite.x,
        y: this.sprite.y,
        rx: this.ammo.hitRadiusForward,
        ry: this.ammo.hitRadiusSide,
        angle: this.travelAngle,
        color: DEBUG_COLORS.projectile,
      },
    ];
  }

  destroy() {
    this.sprite.destroy();
  }
}
