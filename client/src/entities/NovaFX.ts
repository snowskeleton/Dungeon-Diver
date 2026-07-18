import Phaser from "phaser";

// The Mage staff's AOE cast (fxType "nova"): a procedural expanding blast centred
// on the caster, sized to the weapon's AoeSpec.radius. Unlike the directional
// swing strips (AttackFXSprites), there's no art — a ring shockwave races out to
// the blast radius while a soft core flashes and fades. Persistent objects are
// reused per cast; play() restarts the tweens.

const RING_COLOR = 0x9d6bff; // arcane violet
const CORE_COLOR = 0xd8c4ff; // pale core flash
const EXPAND_MS = 320;       // ring travel time — reads as the blast landing

export class NovaFX {
  private ring: Phaser.GameObjects.Arc;
  private core: Phaser.GameObjects.Arc;
  private radius: number;
  private tweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene, radius: number) {
    this.radius = radius;

    // Outer shockwave: an unfilled circle we grow from a point out to `radius`.
    this.ring = scene.add.circle(0, 0, radius);
    this.ring.setStrokeStyle(3, RING_COLOR, 1);
    this.ring.setFillStyle();
    this.ring.setDepth(2.4); // above floor, below HP bars (3)
    this.ring.setVisible(false);

    // Inner flash: a filled disc that blooms briefly at the caster.
    this.core = scene.add.circle(0, 0, radius * 0.55, CORE_COLOR, 0.5);
    this.core.setDepth(2.35);
    this.core.setVisible(false);
  }

  play(x: number, y: number) {
    this.tweens.forEach(t => t.stop());
    this.tweens = [];

    for (const obj of [this.ring, this.core]) {
      obj.setPosition(x, y);
      obj.setVisible(true);
    }

    this.ring.setScale(0.05);
    this.ring.setAlpha(1);
    this.tweens.push(this.ring.scene.tweens.add({
      targets: this.ring,
      scale: 1,
      alpha: 0,
      duration: EXPAND_MS,
      ease: "Cubic.Out",
      onComplete: () => this.ring.setVisible(false),
    }));

    this.core.setScale(0.2);
    this.core.setAlpha(0.6);
    this.tweens.push(this.core.scene.tweens.add({
      targets: this.core,
      scale: 1,
      alpha: 0,
      duration: EXPAND_MS * 0.7,
      ease: "Quad.Out",
      onComplete: () => this.core.setVisible(false),
    }));
  }

  destroy() {
    this.tweens.forEach(t => t.stop());
    this.ring.destroy();
    this.core.destroy();
  }
}
