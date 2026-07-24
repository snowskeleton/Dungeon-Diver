import Phaser from "phaser";
import { WEAPON_REGISTRY, WeaponId } from "shared";
import { UiLayer } from "./UiLayer";
import { LocalPlayer } from "../entities/LocalPlayer";
import { weaponStatLines, viewFromTemplate } from "./weaponStats";
import { promptKeyLabel } from "../options/keybindings";

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
  private readonly goldText: Phaser.GameObjects.Text;
  private readonly pausedText: Phaser.GameObjects.Text;
  private readonly storeCard: Phaser.GameObjects.Text;
  private readonly toast: Phaser.GameObjects.Text;
  private readonly stairsPrompt: Phaser.GameObjects.Text;
  private readonly downedBanner: Phaser.GameObjects.Text;
  private readonly gameOverText: Phaser.GameObjects.Text;
  private readonly scene: Phaser.Scene;
  private toastTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, ui: UiLayer, showControlsHint: boolean) {
    this.scene = scene;
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

    // The shared party purse, under the floor line. Gold reads best in gold.
    this.goldText = ui.add(
      scene.add
        .text(8, 56, "", { fontSize: "13px", color: "#f6c945", backgroundColor: "#00000088" })
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

    this.toast = ui.add(
      scene.add
        .text(400, 460, "", {
          fontSize: "13px", color: "#f6e05e", backgroundColor: "#000000cc",
        })
        .setOrigin(0.5)
        .setDepth(25)
        .setPadding(10, 6)
        .setVisible(false),
    );

    // The party-stairs prompt: shown while at least one player stands on the
    // stairs but the whole party has not gathered yet. Sits above the store card
    // so a shop/reward card on the exit tile doesn't overlap it.
    this.stairsPrompt = ui.add(
      scene.add
        .text(400, 430, "", {
          fontSize: "15px", color: "#f6e05e", backgroundColor: "#000000cc",
          fontStyle: "bold", align: "center",
        })
        .setOrigin(0.5)
        .setDepth(26)
        .setPadding(12, 8)
        .setVisible(false),
    );

    // Shown while a local player is downed: tells them a teammate can pick them
    // up, and shows the revive bar filling. Sits mid-screen, above the store card.
    this.downedBanner = ui.add(
      scene.add
        .text(400, 300, "", {
          fontSize: "18px", color: "#ff8f8f", backgroundColor: "#000000cc",
          fontStyle: "bold", align: "center",
        })
        .setOrigin(0.5)
        .setDepth(28)
        .setPadding(14, 10)
        .setVisible(false),
    );

    this.gameOverText = ui.add(
      scene.add
        .text(400, 288, "GAME OVER", {
          fontSize: "44px", color: "#ff5555", backgroundColor: "#000000dd",
          fontStyle: "bold", align: "center",
        })
        .setOrigin(0.5)
        .setDepth(40)
        .setPadding(20, 14)
        .setVisible(false),
    );

    if (showControlsHint) {
      // Was anchored to the bottom of the MAP, so it sat wherever the last tile
      // row happened to be rather than on screen. It's a HUD line — pin it to the
      // bottom of the viewport like the rest of the readouts.
      // Built from the live bindings so a rebind is reflected here too.
      const move = ["up", "left", "down", "right"].map((a) => promptKeyLabel(a as never)).join("");
      const hint = [
        `Move ${move}`,
        `${promptKeyLabel("attack")}: attack`,
        `${promptKeyLabel("prevSlot")}/${promptKeyLabel("nextSlot")}: switch weapon`,
        `${promptKeyLabel("menu")}: inventory`,
        `${promptKeyLabel("interact")}: interact`,
        "Esc: pause menu",
      ].join("  |  ");
      ui.add(
        scene.add
          .text(8, scene.scale.height - 20, hint, {
            fontSize: "11px", color: "#888888",
          })
          .setDepth(10),
      );
    }
  }

  /** A transient one-line message. Used where a key press has to say why it did
   *  nothing — silence reads as a bug, and a modal would be far too much. */
  flash(text: string, durationMs = 2600): void {
    this.toast.setText(text).setVisible(true);
    this.toastTimer?.remove();
    this.toastTimer = this.scene.time.delayedCall(durationMs, () => this.toast.setVisible(false));
  }

  update(opts: {
    players: LocalPlayer[];
    floor: number;
    gold: number;
    debug: boolean;
    paused: boolean;
    playersOnStairs: number;
    stairsPartySize: number;
  }): void {
    const hpLines = opts.players
      .map((lp, i) => (lp.downed ? `P${i + 1} DOWN` : `P${i + 1} HP: ${Math.round(lp.hp)}`))
      .join("   ");
    this.hpText.setText(hpLines || "Connecting...");
    this.updateDownedBanner(opts.players);
    this.floorText.setText(
      opts.debug ? `Floor ${opts.floor}  ·  DEBUG` : `Floor ${opts.floor}`,
    );
    this.goldText.setText(`Gold: ${opts.gold}`);
    this.pausedText.setVisible(opts.paused);
    this.updateStairsPrompt(opts.playersOnStairs, opts.stairsPartySize);
    this.updateStoreCard(opts.players[0]);
  }

  /** The whole party fell — freeze a GAME OVER card over everything. */
  showGameOver(): void {
    this.gameOverText.setVisible(true);
  }

  // Banner for a downed local player: a filling revive bar (drawn as a text meter)
  // when a teammate is reviving, otherwise the "hold on" prompt. Hidden when every
  // local player is up. Only local players are considered — a downed remote player
  // reads from their ghosted sprite, not this screen-space banner.
  private updateDownedBanner(players: { downed: boolean; reviveProgress: number }[]): void {
    const down = players.find((p) => p.downed);
    if (!down) {
      this.downedBanner.setVisible(false);
      return;
    }
    if (down.reviveProgress > 0) {
      const filled = Math.round(down.reviveProgress * 10);
      const bar = "█".repeat(filled) + "░".repeat(10 - filled);
      this.downedBanner.setText(`Reviving...\n${bar}`);
    } else {
      this.downedBanner.setText("You are down!\nA teammate can revive you");
    }
    this.downedBanner.setVisible(true);
  }

  // Prompt shown while someone is waiting on the stairs. Nothing appears until at
  // least one player is on them; a solo party (size 1) only ever satisfies the
  // whole-party rule the same tick it descends, so the prompt effectively never
  // shows for solo — exactly right.
  private updateStairsPrompt(onStairs: number, partySize: number): void {
    if (onStairs <= 0 || partySize <= 0 || onStairs >= partySize) {
      this.stairsPrompt.setVisible(false);
      return;
    }
    this.stairsPrompt.setText(
      `Waiting for party...  ${onStairs}/${partySize} on the stairs`,
    );
    this.stairsPrompt.setVisible(true);
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
      `${weapon.name}   (${near.cost} gold)\n${stats}\n[F] buy`,
    );
    this.storeCard.setVisible(true);
  }
}
