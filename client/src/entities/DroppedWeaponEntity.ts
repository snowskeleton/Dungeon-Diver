import Phaser from "phaser";
import { WEAPON_REGISTRY, WeaponId } from "shared";
import { InteractPrompt } from "./InteractPrompt";

// In-world view of a weapon lying on the floor — dropped when a player at the
// weapon cap takes a new one, picked back up by anyone whose class can wield it.
// Lightweight (not an Entity — no HP bar, no server-driven movement); it just
// reflects the DroppedWeaponState it's given. Reads like loose loot rather than a
// pedestal (no base, a low shadow) so a swapped-out weapon on the ground doesn't
// get mistaken for a shop or reward prop.
const ICON = 20;

export class DroppedWeaponEntity {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private prompt: InteractPrompt;
  private bobTween?: Phaser.Tweens.Tween;
  readonly x: number;
  readonly y: number;

  constructor(scene: Phaser.Scene, x: number, y: number, weaponId: string, name: string) {
    this.x = x;
    this.y = y;

    const shadow = scene.add.ellipse(x, y + 8, 20, 8, 0x000000, 0.35).setDepth(1.4);
    this.objects.push(shadow);

    const held = WEAPON_REGISTRY[weaponId as WeaponId]?.rangedStyle === "held";
    const icon = held ? scene.add.sprite(x, y, weaponId, 0) : scene.add.image(x, y, weaponId);
    icon.setDisplaySize(ICON, ICON).setDepth(2.5);
    this.objects.push(icon);
    // A gentle bob so a dropped weapon reads as a pick-up-able item, not scenery.
    this.bobTween = scene.tweens.add({
      targets: icon,
      y: y - 4,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const label = scene.add.text(x, y + 12, name, {
      fontSize: "10px", color: "#ffffff", backgroundColor: "#000000aa",
    }).setOrigin(0.5, 0).setDepth(3).setPadding(3, 1);
    this.objects.push(label);

    this.prompt = new InteractPrompt(scene, x, y - 6, "take");
  }

  /** Show/hide the "press F to take" hint (driven by local-player proximity). */
  setPromptShown(shown: boolean) {
    if (shown) this.prompt.show("take");
    else this.prompt.hide();
  }

  destroy() {
    this.bobTween?.stop();
    this.prompt.destroy();
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }
}
