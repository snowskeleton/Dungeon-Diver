import Phaser from "phaser";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";
import { reportPlaceholders } from "./dev/PlaceholderReport";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 576,
  backgroundColor: "#1a1a2e",
  // First entry auto-starts; GameScene is launched from the menu with a LaunchConfig.
  scene: [MenuScene, GameScene],
  pixelArt: true,
  // Phaser only instantiates the gamepad plugin when enabled here;
  // without it, scene.input.gamepad is undefined and P3/P4 pads never work.
  input: {
    gamepad: true,
  },
});

if (import.meta.env.DEV) {
  reportPlaceholders();
  // Handy from the browser console: __game.scene.getScene("GameScene")
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
