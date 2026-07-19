import Phaser from "phaser";
import type { UiLayer } from "./UiLayer";

// A fixed HUD readout of the objective in the room the party is standing in
// ("Wave 2 / 3", "Time 0:32"), hidden everywhere else. Rebuilt only when the text
// actually changes, following InventoryHud's signature discipline.
//
// Deliberately dumb: the line is formatted server-side on the RoomChallenge, so
// this renders whatever it is handed and knows nothing about waves or clocks. A
// new challenge lights it up without touching this file.

export class ChallengeBanner {
  private text: Phaser.GameObjects.Text;
  private sig = "";

  constructor(scene: Phaser.Scene, x: number, y: number, ui: UiLayer) {
    this.text = ui.add(
      scene.add
        .text(x, y, "", {
          fontSize: "16px", color: "#ffd98a",
          backgroundColor: "#1a1a2ee6",
          fontStyle: "bold",
        })
        .setOrigin(0.5, 0)
        .setDepth(25)
        .setPadding(12, 8)
        .setVisible(false),
    );
  }

  /** `challenge` is the synced RoomChallengeState for the room the party is in,
   *  or undefined when that room has no objective. */
  update(challenge: { text: string; complete: boolean } | undefined) {
    // A completed challenge keeps its state entry (the room stays cleared for the
    // rest of the floor), so `complete` — not absence — is what hides the banner.
    const body = !challenge || challenge.complete ? "" : challenge.text;
    if (body === this.sig) return;
    this.sig = body;
    this.text.setText(body);
    this.text.setVisible(body !== "");
  }
}
