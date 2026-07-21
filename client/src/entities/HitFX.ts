import Phaser from "phaser";

// The impact spark played wherever a player's attack connects. The server's one
// combat resolver reports every landed hit (CombatSystem.HitEvent) and GameRoom
// broadcasts the enemy-side ones; this plays a sprite at each point.
//
// Unlike AttackFXSprites — which are OWNED by an entity, anchored to it, and
// re-synced every frame as it moves — a hit spark is fire-and-forget world
// confetti with no owner. It is therefore pooled here rather than living on
// EnemyEntity: a cleave landing on four enemies in one tick needs four sprites,
// and the enemy that was hit may die and be destroyed before the spark finishes.

const KEY = "hit-effect";
const ANIM = "fx-hit";
const FRAME_SIZE = 16;
const FRAMES = 5;

// The art is a 16×16 cell — about half a tile. Scaled up so the impact reads at
// the same weight as the 48px swing strips it punctuates.
const SCALE = 1.75;
// Random placement jitter, in world px, so repeated hits on one enemy don't stack
// into a single flickering sprite.
const JITTER = 5;

export function preloadHitFX(scene: Phaser.Scene) {
  scene.load.spritesheet(KEY, "/sprites/hit-effect.png", {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
  });
}

export function defineHitFXAnimation(scene: Phaser.Scene) {
  if (scene.anims.exists(ANIM)) return;
  scene.anims.create({
    key: ANIM,
    frames: scene.anims.generateFrameNumbers(KEY, {
      frames: Array.from({ length: FRAMES }, (_, i) => i),
    }),
    frameRate: 24,
    repeat: 0,
  });
}

export class HitFX {
  private pool: Phaser.GameObjects.Sprite[] = [];
  // Every sprite ever created, in-flight ones included — pool only holds the idle
  // ones, so destroy() needs its own list to not leak a spark mid-animation.
  private all: Phaser.GameObjects.Sprite[] = [];

  constructor(private scene: Phaser.Scene) {}

  /** Play one spark at a world position. */
  play(x: number, y: number) {
    const sprite = this.pool.pop() ?? this.create();
    sprite.setPosition(
      x + Phaser.Math.Between(-JITTER, JITTER),
      y + Phaser.Math.Between(-JITTER, JITTER),
    );
    // Random quarter-turn + mirror: 8 orientations from one 5-frame strip, so a
    // burst of hits doesn't read as the same stamp repeated.
    sprite.setAngle(Phaser.Math.Between(0, 3) * 90);
    sprite.setFlipX(Math.random() < 0.5);
    sprite.setVisible(true);
    sprite.play(ANIM);
  }

  private create(): Phaser.GameObjects.Sprite {
    const sprite = this.scene.add.sprite(0, 0, KEY);
    sprite.setScale(SCALE);
    // Above entities (depth 2.5 is the swing strip) so the impact is never buried
    // under the enemy it landed on.
    sprite.setDepth(3);
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
