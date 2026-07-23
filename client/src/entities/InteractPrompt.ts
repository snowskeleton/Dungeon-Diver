import Phaser from "phaser";
import { promptKeyLabel } from "../options/keybindings";

// A small world-space "press F" hint that floats above an interactable object
// (shop pedestal, reward pedestal, chest, …) whenever a local player is within
// interaction range. One reusable component so every interactable shares the same
// affordance instead of each growing bespoke prompt code.
//
// The key label is read from the live keybindings via promptKeyLabel, so a rebind
// (which the interact action supports) is reflected the next time the prompt shows.

const DEPTH = 6; // above pedestal price/`?` labels (depth 3)
const OFFSET_Y = -22; // how far above the object's anchor the pill sits

export class InteractPrompt {
  private container: Phaser.GameObjects.Container;
  private label: Phaser.GameObjects.Text;
  private bob?: Phaser.Tweens.Tween;
  private shown = false;

  constructor(scene: Phaser.Scene, x: number, y: number, verb = "open") {
    this.label = scene.add.text(0, 0, "", {
      fontSize: "10px",
      color: "#ffffff",
      backgroundColor: "#000000cc",
      fontStyle: "bold",
    }).setOrigin(0.5).setPadding(5, 3, 5, 3);

    // A thin accent border under the pill so it reads as an interactive prompt
    // rather than a plain caption.
    const border = scene.add.rectangle(0, 0, 2, 2, 0x000000, 0)
      .setStrokeStyle(1, 0xffe066, 0.9)
      .setOrigin(0.5);

    this.container = scene.add.container(x, y + OFFSET_Y, [border, this.label])
      .setDepth(DEPTH)
      .setVisible(false);
    // Size the border to the text once the label has content (set() below).
    this.setVerb(verb);
    const b = this.label.getBounds();
    border.setSize(b.width + 2, b.height + 2);
  }

  private setVerb(verb: string) {
    this.label.setText(`${promptKeyLabel("interact")}  ${verb}`);
  }

  /** Show the prompt (refreshing the key label in case of a live rebind). */
  show(verb = "open") {
    this.setVerb(verb);
    if (this.shown) return;
    this.shown = true;
    this.container.setVisible(true);
    this.bob = this.container.scene.tweens.add({
      targets: this.container,
      y: this.container.y - 3,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.bob?.stop();
    this.bob = undefined;
    this.container.setVisible(false);
  }

  destroy() {
    this.bob?.stop();
    this.container.destroy();
  }
}
