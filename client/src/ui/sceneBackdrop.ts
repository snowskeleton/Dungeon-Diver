import Phaser from "phaser";

/**
 * The canvas behind a DOM menu scene.
 *
 * The browser and lobby are DOM panels, but they still live in Phaser scenes —
 * scene.start is how the game moves between them. Without something drawn, the
 * canvas under the panel is whatever the last scene left there. This is that
 * something: the game's name, so the menus read as one screen rather than a
 * dialog floating over a dead canvas.
 */
export function backdrop(scene: Phaser.Scene, subtitle: string): void {
  scene.cameras.main.setBackgroundColor("#0b0b16");

  scene.add
    .text(400, 200, "GAME 2", { fontSize: "56px", color: "#f6e05e", fontStyle: "bold" })
    .setOrigin(0.5)
    .setAlpha(0.25);

  scene.add
    .text(400, 250, subtitle, { fontSize: "13px", color: "#8888aa" })
    .setOrigin(0.5)
    .setAlpha(0.35);
}
