import Phaser from "phaser";
import { TileId, TILE_SIZE, TILE } from "shared";

const TILESET_KEY = "dungeon-tiles";

// Frame index within dungeon-tiles.png for each TILE constant.
// Frame 0 = empty/transparent padding (not used for rendering).
const TILE_TO_FRAME: Partial<Record<number, number>> = {
  [TILE.FLOOR]:      1,
  [TILE.WALL]:       2,
  [TILE.FIRE]:       3,
  [TILE.SLIME]:      4,
  [TILE.STAIRS]:     5,
  [TILE.BOSS_FLOOR]: 6,
};

export function preloadTiles(scene: Phaser.Scene) {
  scene.load.spritesheet(TILESET_KEY, "/sprites/dungeon-tiles.png", {
    frameWidth: TILE_SIZE,
    frameHeight: TILE_SIZE,
  });

  if (!scene.textures.exists("barrier_tile")) {
    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(0xcc2222);
    gfx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    gfx.lineStyle(2, 0xff4444, 1);
    gfx.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    gfx.generateTexture("barrier_tile", TILE_SIZE, TILE_SIZE);
    gfx.destroy();
  }
}

export function buildMap(
  scene: Phaser.Scene,
  mapData: TileId[][],
  mapRows: number,
  mapCols: number,
): Phaser.GameObjects.Group {
  const group = scene.add.group();

  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) {
      const tileId = mapData[row][col];
      const frame = TILE_TO_FRAME[tileId];
      if (frame === undefined) continue;

      const x = col * TILE_SIZE + TILE_SIZE / 2;
      const y = row * TILE_SIZE + TILE_SIZE / 2;
      const img = scene.add.image(x, y, TILESET_KEY, frame);
      img.setDepth(0);
      group.add(img);

      // The repeat:-1 tweens below outlive their images unless explicitly
      // removed — group.destroy(true) on floor change destroys the images but
      // the TweenManager would keep ticking them forever.
      if (tileId === TILE.FIRE || tileId === TILE.STAIRS || tileId === TILE.BOSS_FLOOR) {
        img.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(img));
      }

      if (tileId === TILE.FIRE) {
        scene.tweens.add({
          targets: img,
          alpha: { from: 0.7, to: 1 },
          duration: 300 + Math.random() * 200,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }

      if (tileId === TILE.STAIRS) {
        scene.tweens.add({
          targets: img,
          scaleX: { from: 1, to: 1.15 },
          scaleY: { from: 1, to: 1.15 },
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }

      if (tileId === TILE.BOSS_FLOOR) {
        scene.tweens.add({
          targets: img,
          alpha: { from: 0.6, to: 1.0 },
          duration: 900 + Math.random() * 300,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      }
    }
  }

  return group;
}
