import Phaser from "phaser";

// The dust puff played wherever an enemy spawns into the world. Enemies are now
// deferred — the server holds a room's enemies hidden until a player walks in, then
// reveals the whole batch at once by adding them to the synced state. GameScene plays
// one puff per enemy the moment its state entry appears (see setupWorldSync's
// enemies.onAdd), so a room's creatures burst into view together in a cloud of dust.
//
// Like HitFX (and unlike the entity-owned attack strips), a puff is fire-and-forget
// world confetti with no owner: it is pooled here rather than living on EnemyEntity,
// because the sprite it announces is a separate object that outlives the effect.

const KEY = "dust-puff";
const ANIM = "fx-dust-puff";
const FRAME_SIZE = 20;
const FRAMES = 17; // dust-puff.png is 340×20 = 17 cells of 20×20

// The art is a 20×20 cell. Scaled up so the cloud reads a little bigger than the
// creature it heralds without swallowing the room.
const SCALE = 1.5;

export function preloadSpawnFX(scene: Phaser.Scene) {
  scene.load.spritesheet(KEY, "/sprites/dust-puff.png", {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
}

export function defineSpawnFXAnimation(scene: Phaser.Scene) {
  if (scene.anims.exists(ANIM)) return;
  scene.anims.create({
    key: ANIM,
    frames: scene.anims.generateFrameNumbers(KEY, {
      frames: Array.from({ length: FRAMES }, (_, i) => i),
    }),
    frameRate: 30,
    repeat: 0,
  });
}

export class SpawnFX {
  private pool: Phaser.GameObjects.Sprite[] = [];
  // Every sprite ever created, in-flight ones included — the pool only holds idle
  // ones, so destroy() needs its own list to not leak a puff mid-animation.
  private all: Phaser.GameObjects.Sprite[] = [];

  constructor(private scene: Phaser.Scene) {}

  /** Play one dust puff at a world position. */
  play(x: number, y: number) {
    const sprite = this.pool.pop() ?? this.create();
    sprite.setPosition(x, y);
    // Random mirror so a batch of puffs firing at once doesn't read as the same
    // stamp repeated.
    sprite.setFlipX(Math.random() < 0.5);
    sprite.setVisible(true);
    sprite.play(ANIM);
  }

  private create(): Phaser.GameObjects.Sprite {
    const sprite = this.scene.add.sprite(0, 0, KEY);
    sprite.setScale(SCALE);
    // Just below the impact spark (depth 3) but above entities, so the cloud sits
    // in front of the creature emerging from it.
    sprite.setDepth(2.8);
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
