import Phaser from "phaser";
import type { DebugDrawable, DebugShape } from "./DebugDraw";

// Press H to toggle a live overlay of every collision/attack shape in the scene:
// player + enemy bodies, weapon swing hurtboxes, enemy attack/aggro radii, and
// projectile hit ellipses. Each entity implements DebugDrawable.collectDebugShapes();
// this class just draws whatever it's handed, so adding a new shape source never
// touches this file.
export class HitboxDebug {
  private gfx: Phaser.GameObjects.Graphics;
  private enabled = false;
  private toggleKey: Phaser.Input.Keyboard.Key;

  constructor(scene: Phaser.Scene, startEnabled = false) {
    this.enabled = startEnabled;
    this.gfx = scene.add.graphics().setDepth(100);
    this.toggleKey = scene.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.H,
    );
    this.toggleKey.on("down", () => {
      this.enabled = !this.enabled;
      if (!this.enabled) this.gfx.clear();
    });
  }

  update(drawables: Iterable<DebugDrawable>) {
    if (!this.enabled) return;
    this.gfx.clear();
    for (const d of drawables) {
      for (const shape of d.collectDebugShapes()) this.draw(shape);
    }
  }

  private draw(s: DebugShape) {
    switch (s.kind) {
      case "circle":
        if (s.fill !== undefined) {
          this.gfx.fillStyle(s.color, s.fill);
          this.gfx.fillCircle(s.x, s.y, s.r);
        }
        this.gfx.lineStyle(1, s.color, 0.9);
        this.gfx.strokeCircle(s.x, s.y, s.r);
        break;
      case "rect":
        if (s.fill !== undefined) {
          this.gfx.fillStyle(s.color, s.fill);
          this.gfx.fillRect(s.x, s.y, s.w, s.h);
        }
        this.gfx.lineStyle(1, s.color, 0.9);
        this.gfx.strokeRect(s.x, s.y, s.w, s.h);
        break;
      case "ellipse":
        this.strokeEllipse(s);
        break;
    }
  }

  // Phaser Graphics has no rotated-ellipse primitive, so trace one as a polygon:
  // sample points around the ellipse in local space, rotate by `angle`, offset to
  // center, then stroke (and optionally fill) the closed loop.
  private strokeEllipse(s: Extract<DebugShape, { kind: "ellipse" }>) {
    const SEGMENTS = 24;
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const t = (i / SEGMENTS) * Math.PI * 2;
      const lx = Math.cos(t) * s.rx;
      const ly = Math.sin(t) * s.ry;
      pts.push(new Phaser.Math.Vector2(s.x + lx * cos - ly * sin, s.y + lx * sin + ly * cos));
    }
    if (s.fill !== undefined) {
      this.gfx.fillStyle(s.color, s.fill);
      this.gfx.fillPoints(pts, true);
    }
    this.gfx.lineStyle(1, s.color, 0.9);
    this.gfx.strokePoints(pts, true, true);
  }

  destroy() {
    this.gfx.destroy();
  }
}
