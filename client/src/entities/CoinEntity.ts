import Phaser from "phaser";
import { CoinStateView } from "shared";

// The in-world view of one gold coin (GameState.coins). Lightweight like a
// projectile — no HP bar, no Entity base — it just lerps toward the server-driven
// position (the server handles the 3s idle and the homing pull) and spins its
// pickup animation. When the server collects a coin it removes it from the synced
// map; GameScene answers that onRemove by playing CoinFX (the sparkle) at the coin's
// last spot, which is the "finish the animation with a sparkle" flourish.

const KEY = "coin";
const ANIM = "fx-coin-spin";
const FRAME_SIZE = 16;
const FRAMES = 5; // coin.png is 80×16 = 5 cells of 16×16
const DISPLAY = 14;

// The collect sparkle: the last two frames of the gold-star burst.
const FX_KEY = "coin-sparkle";
const FX_ANIM = "fx-coin-sparkle";
const FX_FRAMES = 2; // coin-sparkle.png is 32×16 = 2 cells of 16×16
const FX_DISPLAY = 18;
const FX_MS = 260;

export function preloadCoin(scene: Phaser.Scene) {
  scene.load.spritesheet(KEY, "/sprites/coin.png", {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
  scene.load.spritesheet(FX_KEY, "/sprites/coin-sparkle.png", {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
}

export function defineCoinAnimations(scene: Phaser.Scene) {
  if (!scene.anims.exists(ANIM)) {
    scene.anims.create({
      key: ANIM,
      frames: scene.anims.generateFrameNumbers(KEY, {
        frames: Array.from({ length: FRAMES }, (_, i) => i),
      }),
      frameRate: 10,
      repeat: -1,
    });
  }
  if (!scene.anims.exists(FX_ANIM)) {
    scene.anims.create({
      key: FX_ANIM,
      frames: scene.anims.generateFrameNumbers(FX_KEY, {
        frames: Array.from({ length: FX_FRAMES }, (_, i) => i),
      }),
      frameRate: FX_FRAMES / (FX_MS / 1000),
      repeat: 0,
    });
  }
}

export class CoinEntity {
  private sprite: Phaser.GameObjects.Sprite;
  private targetX: number;
  private targetY: number;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.targetX = x;
    this.targetY = y;
    this.sprite = scene.add.sprite(x, y, KEY);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setDepth(1.6); // above the floor, below entities
    this.sprite.setDisplaySize(DISPLAY, DISPLAY);
    this.sprite.play(ANIM);
  }

  setTarget(state: CoinStateView) {
    this.targetX = state.x;
    this.targetY = state.y;
  }

  update() {
    // Follows the server closely — a homing coin is fast, and lag reads as the
    // coin "escaping" the player.
    this.sprite.x += (this.targetX - this.sprite.x) * 0.4;
    this.sprite.y += (this.targetY - this.sprite.y) * 0.4;
  }

  destroy() {
    this.sprite.destroy();
  }
}

/** The pooled one-shot collect sparkle, played wherever a coin is swept up — the
 *  same fire-and-forget world-confetti pattern as HitFX / SpawnFX (the coin it
 *  announces is already gone, so the effect can't live on it). */
export class CoinFX {
  private pool: Phaser.GameObjects.Sprite[] = [];
  private all: Phaser.GameObjects.Sprite[] = [];

  constructor(private scene: Phaser.Scene) {}

  play(x: number, y: number) {
    const sprite = this.pool.pop() ?? this.create();
    sprite.setPosition(x, y);
    sprite.setVisible(true);
    sprite.play(FX_ANIM);
  }

  private create(): Phaser.GameObjects.Sprite {
    const sprite = this.scene.add.sprite(0, 0, FX_KEY);
    sprite.setDisplaySize(FX_DISPLAY, FX_DISPLAY);
    sprite.setDepth(3); // with the impact spark, above entities
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      sprite.setVisible(false);
      this.pool.push(sprite);
    });
    this.all.push(sprite);
    return sprite;
  }

  destroy() {
    for (const s of this.all) s.destroy();
    this.all = [];
    this.pool = [];
  }
}
