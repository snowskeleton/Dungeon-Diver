import Phaser from "phaser";
import { MenuScene } from "./scenes/MenuScene";
import { BrowseScene } from "./scenes/BrowseScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { GameScene } from "./scenes/GameScene";
import { reportPlaceholders } from "./dev/PlaceholderReport";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 576,
  backgroundColor: "#1a1a2e",
  // First entry auto-starts. The rest is one path: menu → (browser) → lobby →
  // game, each handing the next the Party it already holds.
  scene: [MenuScene, BrowseScene, LobbyScene, GameScene],
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
