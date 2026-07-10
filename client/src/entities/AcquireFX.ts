import Phaser from "phaser";
import { WEAPON_REGISTRY, WeaponId } from "shared";
import { weaponStatLines } from "../ui/weaponStats";

// A one-shot "item get!" flourish (Zelda style) played when a weapon is first
// acquired: the weapon icon pops up above the player's head with a burst ring,
// while a centered panel names the weapon and lists its expanded stats. Fully
// self-contained — it follows the target sprite, then destroys itself.
const HOLD_MS = 1200;
const POP_MS = 260;
const OUT_MS = 320;
export const ACQUIRE_MS = POP_MS + HOLD_MS + OUT_MS;

const ICON = 40;
const HEAD_OFFSET = 30; // px above the sprite anchor

export class AcquireFX {
  private scene: Phaser.Scene;
  private target: Phaser.GameObjects.Components.Transform & { x: number; y: number };
  private objects: Phaser.GameObjects.GameObject[] = [];
  private icon: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  private ring: Phaser.GameObjects.Arc;
  private onUpdate: () => void;

  constructor(scene: Phaser.Scene, target: { x: number; y: number }, weaponId: string) {
    this.scene = scene;
    this.target = target as any;
    const weapon = WEAPON_REGISTRY[weaponId as WeaponId];
    const x = this.target.x;
    const y = this.target.y - HEAD_OFFSET;

    // Burst ring behind the icon.
    this.ring = scene.add.circle(x, y, 6, undefined, 0).setStrokeStyle(3, 0xffe066, 0.9).setDepth(19);
    this.objects.push(this.ring);
    scene.tweens.add({ targets: this.ring, radius: 34, alpha: { from: 0.9, to: 0 }, duration: POP_MS + 200, ease: "Cubic.easeOut" });

    // The weapon icon, popping in with a back-ease overshoot then a gentle bob.
    const held = weapon?.rangedStyle === "held";
    this.icon = held ? scene.add.sprite(x, y, weaponId, 0) : scene.add.image(x, y, weaponId);
    this.icon.setDisplaySize(ICON, ICON).setDepth(20).setScale(0);
    this.objects.push(this.icon);
    const fullScale = this.icon.scaleX; // scale that yields ICON px
    scene.tweens.add({
      targets: this.icon, scale: fullScale, duration: POP_MS, ease: "Back.easeOut",
      onComplete: () => {
        scene.tweens.add({ targets: this.icon, y: y - 6, duration: 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      },
    });

    // Centered panel: "Got <Name>!" + expanded stats (scroll-locked, screen-space).
    const stats = weapon ? weaponStatLines(weapon).map((s) => `${s.label}: ${s.value}`).join("    ") : "";
    const panel = scene.add
      .text(400, 120, `Got ${weapon?.name ?? weaponId}!\n${stats}`, {
        fontSize: "14px", color: "#fff7cc", backgroundColor: "#1a1a2eee",
        align: "center", lineSpacing: 4, fontStyle: "bold",
      })
      .setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(21).setPadding(14, 10).setAlpha(0);
    this.objects.push(panel);
    scene.tweens.add({ targets: panel, alpha: 1, duration: POP_MS, ease: "Cubic.easeOut" });

    // Keep everything anchored over the (possibly moving) player.
    this.onUpdate = () => {
      this.icon.x = this.target.x;
      this.ring.x = this.target.x;
      this.ring.y = this.target.y - HEAD_OFFSET;
      // icon.y is tween-owned (bob), so only sync x.
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);

    // Fade out and clean up.
    scene.time.delayedCall(POP_MS + HOLD_MS, () => {
      scene.tweens.killTweensOf(this.icon);
      scene.tweens.add({
        targets: this.objects, alpha: 0, y: "-=16", duration: OUT_MS, ease: "Cubic.easeIn",
        onComplete: () => this.destroy(),
      });
    });
  }

  private destroy() {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }
}
