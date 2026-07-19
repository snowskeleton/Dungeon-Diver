import Phaser from "phaser";
import { WEAPON_REGISTRY, WeaponId, WeaponSlotView } from "shared";
import type { UiLayer } from "./UiLayer";

// A fixed HUD row of the local player's owned weapons, with the active slot
// highlighted. Rebuilt only when the inventory or active slot actually changes
// (cheap no-op otherwise). Weapon texture keys are the weapon id (held ranged
// weapons are 2-frame draw sheets, so those render frame 0).
const SLOT = 30;
const GAP = 4;
const X0 = 8;
const ICON = 22;

export class InventoryHud {
  private scene: Phaser.Scene;
  private y: number;
  private ui: UiLayer;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private sig = "";

  constructor(scene: Phaser.Scene, y: number, ui: UiLayer) {
    this.scene = scene;
    this.y = y;
    this.ui = ui;
  }

  update(weapons: WeaponSlotView[], activeIndex: number) {
    // Signature is built from uids, not a join() of the array: slots are objects,
    // so join() would yield `[object Object]` for every one of them, compare equal
    // forever, and the HUD would silently never rebuild.
    const sig = `${weapons.map((w) => w.uid).join(",")}|${activeIndex}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.clear();

    weapons.forEach((slot, i) => {
      const id = slot.weaponId;
      const cx = X0 + i * (SLOT + GAP) + SLOT / 2;
      const cy = this.y + SLOT / 2;
      const active = i === activeIndex;

      // Slots are rebuilt on every change, so each new object has to be claimed
      // for the UI camera — it is not a one-time registration at construction.
      const frame = this.ui.add(
        this.scene.add
          .rectangle(cx, cy, SLOT, SLOT, 0x000000, 0.55)
          .setStrokeStyle(2, active ? 0xffe066 : 0x555577)
          .setDepth(10),
      );
      this.objects.push(frame);

      const held = WEAPON_REGISTRY[id as WeaponId]?.rangedStyle === "held";
      // Held ranged icons are spritesheets — show frame 0 (relaxed bow).
      const icon = held
        ? this.scene.add.sprite(cx, cy, id, 0)
        : this.scene.add.image(cx, cy, id);
      icon.setDisplaySize(ICON, ICON).setDepth(11);
      this.ui.add(icon);
      if (!active) icon.setAlpha(0.65);
      this.objects.push(icon);
    });
  }

  private clear() {
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }

  destroy() {
    this.clear();
  }
}
