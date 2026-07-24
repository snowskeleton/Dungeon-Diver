import Phaser from "phaser";
import { WEAPON_REGISTRY, WeaponId } from "shared";
import { InteractPrompt } from "./InteractPrompt";

// In-world view of one shop pedestal: a pedestal base, the weapon icon hovering
// above it, and a gold-cost label. Lightweight (not an Entity — no HP bar / no
// server-driven movement); it just reflects the ShopItemState it's given.
const ICON = 22;

export class ShopItemEntity {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private icon: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  private prompt: InteractPrompt;
  readonly x: number;
  readonly y: number;

  constructor(scene: Phaser.Scene, x: number, y: number, weaponId: string, cost: number) {
    this.x = x;
    this.y = y;

    const pedestal = scene.add.ellipse(x, y + 6, 26, 12, 0x2a2a3a, 0.9)
      .setStrokeStyle(1, 0x6666aa).setDepth(1.5);
    this.objects.push(pedestal);

    const held = WEAPON_REGISTRY[weaponId as WeaponId]?.rangedStyle === "held";
    this.icon = held ? scene.add.sprite(x, y - 6, weaponId, 0) : scene.add.image(x, y - 6, weaponId);
    this.icon.setDisplaySize(ICON, ICON).setDepth(2.5);
    this.objects.push(this.icon);

    const label = scene.add.text(x, y + 14, `${cost} gold`, {
      fontSize: "10px", color: "#f6c945", backgroundColor: "#000000aa",
    }).setOrigin(0.5, 0).setDepth(3).setPadding(3, 1);
    this.objects.push(label);

    this.prompt = new InteractPrompt(scene, x, y - 6, "buy");
  }

  /** Show/hide the "press F to buy" hint (driven by local-player proximity). */
  setPromptShown(shown: boolean) {
    if (shown) this.prompt.show("buy");
    else this.prompt.hide();
  }

  // Reflect the shared-pool purchased state: dim the pedestal to a ghost once
  // anyone on the team has bought it.
  setPurchased(purchased: boolean) {
    this.objects.forEach((o) => (o as any).setAlpha?.(purchased ? 0.2 : 1));
  }

  destroy() {
    this.prompt.destroy();
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }
}
