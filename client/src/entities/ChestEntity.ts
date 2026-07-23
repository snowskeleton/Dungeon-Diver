import Phaser from "phaser";
import { InteractPrompt } from "./InteractPrompt";

// In-world view of a treasure chest. Same "not an Entity — no HP bar, no
// server-driven movement, just reflects its state" shape as ShopItemEntity and
// OfferPedestalEntity, but this one has real art, so the open is an animation
// rather than an alpha change.
//
// Sheet (assets/chest.png) is 6 cols x 2 rows of 16px: row 0 is the common
// brown/silver chest, row 1 the rarer gold one. Within a row the frames run
// closed -> shake -> burst -> settled-open, so frame 0 is the idle closed pose and
// the last frame is the resting open one.

const TEXTURE = "chest";
const COLS = 6;
const SIZE = 28;

/** Row 0 = brown, row 1 = gold. */
function firstFrame(gold: boolean): number {
  return gold ? COLS : 0;
}

export function preloadChest(scene: Phaser.Scene) {
  scene.load.spritesheet(TEXTURE, "/sprites/chest.png", {
    frameWidth: 16,
    frameHeight: 16,
  });
}

export function defineChestAnimations(scene: Phaser.Scene) {
  for (const gold of [false, true]) {
    const start = firstFrame(gold);
    // The anim manager outlives the scene and GameScene is restartable, so a
    // second create() with the same key would warn and no-op.
    if (scene.anims.exists(chestOpenKey(gold))) continue;
    scene.anims.create({
      key: chestOpenKey(gold),
      frames: scene.anims.generateFrameNumbers(TEXTURE, {
        start: start + 1,
        end: start + COLS - 1,
      }),
      frameRate: 12,
      // The chest stays open forever once opened, so the animation holds its last
      // frame rather than looping or snapping back to closed.
      repeat: 0,
    });
  }
}

function chestOpenKey(gold: boolean): string {
  return gold ? "chest-open-gold" : "chest-open-brown";
}

export class ChestEntity {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private sprite: Phaser.GameObjects.Sprite;
  private prompt: InteractPrompt;
  private opened = false;
  readonly x: number;
  readonly y: number;

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly gold: boolean, opened: boolean) {
    this.x = x;
    this.y = y;

    const shadow = scene.add.ellipse(x, y + 11, 24, 8, 0x000000, 0.35).setDepth(1.4);
    this.objects.push(shadow);

    this.sprite = scene.add.sprite(x, y, TEXTURE, firstFrame(gold))
      .setDisplaySize(SIZE, SIZE).setDepth(2.2);
    this.objects.push(this.sprite);

    this.prompt = new InteractPrompt(scene, x, y - 4, "open");

    // A chest that was already open when this view appeared (a late joiner, or
    // walking back into a looted room) skips straight to the resting open frame —
    // replaying the burst would read as someone opening it just now.
    if (opened) this.showOpened();
  }

  /** Show/hide the "press F to open" hint. An opened chest never prompts. */
  setPromptShown(shown: boolean) {
    if (shown && !this.opened) this.prompt.show("open");
    else this.prompt.hide();
  }

  /** Drive the open animation from the synced `opened` flag. Idempotent: the
   *  animation plays exactly once no matter how often onChange fires. */
  setOpened(opened: boolean) {
    if (!opened || this.opened) return;
    this.opened = true;
    this.prompt.hide();
    this.sprite.play(chestOpenKey(this.gold));
  }

  private showOpened() {
    this.opened = true;
    this.sprite.setFrame(firstFrame(this.gold) + COLS - 1);
  }

  destroy() {
    this.prompt.destroy();
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
  }
}
