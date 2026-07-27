import Phaser from "phaser";
import { WeaponSlotView, UpgradeSlotView } from "shared";
import { weaponStatLines, viewFromSlot } from "../ui/weaponStats";
import { UiLayer } from "../ui/UiLayer";

// A one-shot "item get!" flourish (Zelda style) played when a boon is first
// acquired: a burst ring pops above the player's head (with the weapon icon, for
// weapons), while a centered panel names the pickup and describes it. Fully
// self-contained — it follows the target sprite, then destroys itself.
//
// Two kinds of pickup share this: a WEAPON (icon + rolled stats) and an UPGRADE
// (a buff with no in-world icon — the panel carries its human-readable
// description so the playtester can tell what Berserk / Iron Skin actually do).
const HOLD_MS = 1200;
const POP_MS = 260;
const OUT_MS = 320;
export const ACQUIRE_MS = POP_MS + HOLD_MS + OUT_MS;

const ICON = 40;
const HEAD_OFFSET = 30; // px above the sprite anchor

// The normalized content of a flourish: an optional world-space icon and the
// centered text panel. Both pickup kinds reduce to this before rendering.
interface FlourishSpec {
  title: string;
  body: string;
  icon: {
    key: string;
    asSprite: boolean;
  } | null;
}

export class AcquireFX {
  private scene: Phaser.Scene;
  private target: Phaser.GameObjects.Components.Transform & { x: number; y: number };
  private objects: Phaser.GameObjects.GameObject[] = [];
  private icon: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | null = null;
  private ring: Phaser.GameObjects.Arc;
  private onUpdate: () => void;

  // Takes the synced SLOT, not a weapon id, so the panel shows the stats of the
  // weapon you actually picked up — a rolled +2 broadsword reads 14, not 12.
  static weapon(scene: Phaser.Scene, target: { x: number; y: number }, slot: WeaponSlotView) {
    const weapon = viewFromSlot(slot);
    const stats = weapon ? weaponStatLines(weapon).map((s) => `${s.label}: ${s.value}`).join("    ") : "";
    // Rolled modifiers get their own line so the pickup reads as special.
    const mods = slot.modLabels?.length ? `${Array.from(slot.modLabels).join("  ")}\n` : "";
    return new AcquireFX(scene, target, {
      title: `Got ${weapon?.name ?? slot.weaponId}!`,
      body: `${mods}${stats}`,
      icon: {
        key: slot.weaponId,
        asSprite: weapon?.rangedStyle === "held",
      },
    });
  }

  // Takes the synced upgrade slot, whose `description` is authored next to the
  // stats it describes (server-side Upgrade getters) — so the flourish tells the
  // player what the buff does, not just its name. Upgrades have no in-world icon.
  static upgrade(scene: Phaser.Scene, target: { x: number; y: number }, slot: UpgradeSlotView) {
    return new AcquireFX(scene, target, {
      title: `Got ${slot.name}!`,
      body: slot.description,
      icon: null,
    });
  }

  private constructor(scene: Phaser.Scene, target: { x: number; y: number }, spec: FlourishSpec) {
    this.scene = scene;
    this.target = target as any;
    const x = this.target.x;
    const y = this.target.y - HEAD_OFFSET;

    // Burst ring behind the icon.
    this.ring = scene.add.circle(x, y, 6, undefined, 0).setStrokeStyle(3, 0xffe066, 0.9).setDepth(19);
    this.objects.push(this.ring);
    scene.tweens.add({ targets: this.ring, radius: 34, alpha: { from: 0.9, to: 0 }, duration: POP_MS + 200, ease: "Cubic.easeOut" });

    // The pickup icon, popping in with a back-ease overshoot then a gentle bob.
    // Upgrades have no in-world icon — the ring alone carries the world beat.
    if (spec.icon) {
      const icon = spec.icon.asSprite
        ? scene.add.sprite(x, y, spec.icon.key, 0)
        : scene.add.image(x, y, spec.icon.key);
      icon.setDisplaySize(ICON, ICON).setDepth(20).setScale(0);
      this.icon = icon;
      this.objects.push(icon);
      const fullScale = icon.scaleX; // scale that yields ICON px
      scene.tweens.add({
        targets: icon, scale: fullScale, duration: POP_MS, ease: "Back.easeOut",
        onComplete: () => {
          scene.tweens.add({ targets: icon, y: y - 6, duration: 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        },
      });
    }

    // Centered panel: "Got <Name>!" + description/stats. Screen-space, so it goes
    // on the UI camera — the ring and icon above stay world-space to track the
    // player.
    const panel = scene.add
      .text(400, 120, `${spec.title}\n${spec.body}`, {
        fontSize: "14px", color: "#fff7cc", backgroundColor: "#1a1a2eee",
        align: "center", lineSpacing: 4, fontStyle: "bold",
      })
      .setOrigin(0.5, 0.5).setDepth(21).setPadding(14, 10).setAlpha(0);
    UiLayer.of(scene)?.add(panel);
    this.objects.push(panel);
    scene.tweens.add({ targets: panel, alpha: 1, duration: POP_MS, ease: "Cubic.easeOut" });

    // Keep everything anchored over the (possibly moving) player.
    this.onUpdate = () => {
      if (this.icon) this.icon.x = this.target.x;
      this.ring.x = this.target.x;
      this.ring.y = this.target.y - HEAD_OFFSET;
      // icon.y is tween-owned (bob), so only sync x.
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);

    // Fade out and clean up.
    scene.time.delayedCall(POP_MS + HOLD_MS, () => {
      if (this.icon) scene.tweens.killTweensOf(this.icon);
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
