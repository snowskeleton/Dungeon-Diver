import Phaser from "phaser";
import { InteractPrompt } from "./InteractPrompt";

// In-world view of a single-reward pedestal — the thing dropped where a room's
// last enemy fell. A near-sibling of OfferPedestalEntity (same "not an Entity, no
// HP bar, just reflects its state" shape), but where an offer hides its cards
// behind a "?", this one previews the one reward it holds: its name, tinted by
// kind. The full stats still arrive in the AcquireFX when a player takes it.

type RewardKind = "weapon" | "upgrade" | "gold";

// Glow tint per kind, so a pedestal reads at a glance before you're close enough
// to read the label.
const KIND_GLOW: Record<RewardKind, number> = {
  weapon: 0xffc04d,
  upgrade: 0x66ddff,
  gold: 0xffe066,
};

export class RewardPedestalEntity {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private glow: Phaser.GameObjects.Arc;
  private glowTween?: Phaser.Tweens.Tween;
  private prompt: InteractPrompt;
  readonly x: number;
  readonly y: number;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: RewardKind, name: string, claimed: boolean) {
    this.x = x;
    this.y = y;

    const base = scene.add.ellipse(x, y + 6, 30, 14, 0x2a2a3a, 0.9)
      .setStrokeStyle(1, 0x8888cc).setDepth(1.5);
    this.objects.push(base);

    const tint = KIND_GLOW[kind];
    this.glow = scene.add.circle(x, y - 4, 9, tint, 0.55).setDepth(2.4);
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

    const label = scene.add.text(x, y + 16, name, {
      fontSize: "10px", color: "#ffffff", backgroundColor: "#000000aa", fontStyle: "bold",
    }).setOrigin(0.5, 0).setDepth(3).setPadding(4, 1);
    this.objects.push(label);

    this.prompt = new InteractPrompt(scene, x, y - 4, "take");

    // A pedestal already claimed when this view appeared (a late joiner walking
    // back into a looted room) shows ghosted, no burst.
    if (claimed) this.setClaimed(true);
  }

  /** Show/hide the "press F to take" hint (driven by local-player proximity). */
  setPromptShown(shown: boolean) {
    if (shown) this.prompt.show("take");
    else this.prompt.hide();
  }

  /** Ghost out once claimed. The pulsing glow has to be stopped first — its tween
   *  drives alpha every frame and would otherwise fight setAlpha and keep shining. */
  setClaimed(claimed: boolean) {
    if (claimed) this.prompt.hide();
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
