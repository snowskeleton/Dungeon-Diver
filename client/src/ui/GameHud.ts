import Phaser from "phaser";
import { WEAPON_REGISTRY, WeaponId } from "shared";
import { UiLayer } from "./UiLayer";
import { LocalPlayer } from "../entities/LocalPlayer";
import { weaponStatLines, viewFromTemplate } from "./weaponStats";

/**
 * The always-on screen furniture: party HP, the floor line, the PAUSED overlay,
 * the P1 store card, and the controls hint.
 *
 * These were built and updated inline in GameScene, which owns quite enough
 * already (scene lifecycle, world sync, camera). This follows the pattern
 * InventoryHud and ChallengeBanner set — a small class that owns its own display
 * objects and exposes one update() — so HUD work has an obvious home.
 *
 * Everything lives on the UiLayer, i.e. the zoom-1 UI camera. Note that
 * setScrollFactor(0) is NOT a substitute: it does not exempt an object from
 * camera zoom, so a "screen-space" readout added to the world camera renders
 * double-size and displaced at the default 2x.
 */
export class GameHud {
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly floorText: Phaser.GameObjects.Text;
  private readonly pausedText: Phaser.GameObjects.Text;
  private readonly storeCard: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, ui: UiLayer, showControlsHint: boolean) {
    this.hpText = ui.add(
      scene.add
        .text(8, 8, "", { fontSize: "14px", color: "#ffffff", backgroundColor: "#00000088" })
        .setDepth(10)
        .setPadding(6, 4),
    );

    this.floorText = ui.add(
      scene.add
        .text(8, 32, "", { fontSize: "13px", color: "#f6e05e", backgroundColor: "#00000088" })
        .setDepth(10)
        .setPadding(6, 4),
    );

    this.pausedText = ui.add(
      scene.add
        .text(400, 288, "PAUSED", {
          fontSize: "40px", color: "#ffffff", backgroundColor: "#000000aa",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(30)
        .setPadding(16, 10)
        .setVisible(false),
    );

    this.storeCard = ui.add(
      scene.add
        .text(400, 500, "", {
          fontSize: "12px", color: "#e0e0ff", backgroundColor: "#1a1a2ee6",
          align: "left", lineSpacing: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(20)
        .setPadding(10, 8)
        .setVisible(false),
    );

    if (showControlsHint) {
      // Was anchored to the bottom of the MAP, so it sat wherever the last tile
      // row happened to be rather than on screen. It's a HUD line — pin it to the
      // bottom of the viewport like the rest of the readouts.
      ui.add(
        scene.add
          .text(8, scene.scale.height - 20,
            "WASD+Space  |  P2: Arrows+Enter  |  Q/E: switch weapon  |  I: pause  |  F: buy  |  P: join  |  Esc: menu", {
            fontSize: "11px", color: "#888888",
          })
          .setDepth(10),
      );
    }
  }

  update(opts: {
    players: LocalPlayer[];
    floor: number;
    debug: boolean;
    paused: boolean;
  }): void {
    const hpLines = opts.players
      .map((lp, i) => `P${i + 1} HP: ${Math.round(lp.hp)}`)
      .join("   ");
    this.hpText.setText(hpLines || "Connecting...");
    this.floorText.setText(
      opts.debug ? `Floor ${opts.floor}  ·  DEBUG` : `Floor ${opts.floor}`,
    );
    this.pausedText.setVisible(opts.paused);
    this.updateStoreCard(opts.players[0]);
  }

  // Show the P1 store card whenever P1 is standing on an unpurchased pedestal, or
  // a short prompt when standing on an unclaimed reward pedestal. The reward's
  // contents deliberately stay hidden until the picker opens — the card would
  // spoil the choice, and the pedestal's "?" is the whole tease.
  private updateStoreCard(first?: LocalPlayer): void {
    if (first?.nearbyOffer) {
      this.storeCard.setText("A reward waits here\n[F] choose");
      this.storeCard.setVisible(true);
      return;
    }
    const near = first?.nearbyShopItem;
    // A shop pedestal holds an unmodified template, so its card reads from the
    // template. When pedestals start rolling modifiers this becomes a slot view.
    const template = near ? WEAPON_REGISTRY[near.weaponId as WeaponId] : undefined;
    if (!near || !template) {
      this.storeCard.setVisible(false);
      return;
    }
    const weapon = viewFromTemplate(template);
    const stats = weaponStatLines(weapon).map((s) => `  ${s.label}: ${s.value}`).join("\n");
    this.storeCard.setText(
      `${weapon.name}   (${near.cost} HP)\n${stats}\n[F] buy`,
    );
    this.storeCard.setVisible(true);
  }
}
