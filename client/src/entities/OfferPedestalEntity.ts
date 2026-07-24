import Phaser from "phaser";
import { InteractPrompt } from "./InteractPrompt";

// In-world view of a reward pedestal (shrine boon / boss drop). Deliberately a
// near-sibling of ShopItemEntity — same "not an Entity, no HP bar, just reflects
// its state" shape — but it shows no price and no weapon icon, because the reward
// isn't decided until the player opens the picker.
const GLOW = 0xffe066;

export class OfferPedestalEntity {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private glow: Phaser.GameObjects.Arc;
  private glowTween?: Phaser.Tweens.Tween;
  private prompt: InteractPrompt;
  readonly x: number;
  readonly y: number;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.x = x;
    this.y = y;

    const base = scene.add.ellipse(x, y + 6, 30, 14, 0x2a2a3a, 0.9)
      .setStrokeStyle(1, 0x8888cc).setDepth(1.5);
    this.objects.push(base);

    // A slow pulse so it reads as "interactive reward" without needing art yet.
    this.glow = scene.add.circle(x, y - 4, 9, GLOW, 0.55).setDepth(2.4);
    this.objects.push(this.glow);
    this.glowTween = scene.tweens.add({
      targets: this.glow,
      scale: 1.35,
      alpha: 0.2,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const label = scene.add.text(x, y + 16, "?", {
      fontSize: "11px", color: "#ffe066", backgroundColor: "#000000aa", fontStyle: "bold",
    }).setOrigin(0.5, 0).setDepth(3).setPadding(4, 1);
    this.objects.push(label);

    this.prompt = new InteractPrompt(scene, x, y - 4, "take");
  }

  /** Show/hide the "press F to take" hint (driven by local-player proximity). */
  setPromptShown(shown: boolean) {
    if (shown) this.prompt.show("take");
    else this.prompt.hide();
  }

  /** Ghost out once claimed. The pulsing glow has to be stopped first — its tween
   *  drives alpha every frame and would otherwise fight setAlpha and keep shining. */
  setClaimed(claimed: boolean) {
    if (claimed && this.glowTween) {
      this.glowTween.stop();
      this.glowTween = undefined;
    }
    this.objects.forEach((o) => (o as any).setAlpha?.(claimed ? 0.15 : 1));
  }

  destroy() {
    this.prompt.destroy();
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }
}
