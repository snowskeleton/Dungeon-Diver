import Phaser from "phaser";
import { VAULT_PEAK_HEIGHT } from "shared";

// The little world-space furniture for a player's class movement ability: a ground
// shadow under a Vaulting player, a cooldown "loading" bar under everyone that
// fills as the ability recharges and hides once ready, and a one-shot burst when
// an ability fires. Owned by the client Entity (one per player), driven each frame
// from the synced airHeight / abilityCooldownFrac / abilitySeq.

const BAR_W = 22;
const BAR_H = 3;
// Below the feet (sprite centre + this), clear of the HP bar which sits above.
const BAR_DROP = 22;

// Per-ability accent for the fire-off burst.
const ABILITY_COLORS: Record<string, number> = {
  charge: 0xf6a623, // Knight — orange rush
  blink:  0x63b3ff, // Mage — arcane cyan
  dash:   0xffffff, // Rogue — white afterimage
  vault:  0x68d391, // Ranger — green leap
};

// Dust FX sprite sheet (from the SOA2 pack), played one-shot at a player's feet.
// The same low puff is used for both a Ranger's Vault landing and each step of a
// Knight's Charge (one is started per step and left to finish in place behind him).
const LAND_DUST = { key: "dust-land", file: "/sprites/dust-land.png", fw: 10, fh: 10, frames: 13 };

export function preloadMovementFX(scene: Phaser.Scene) {
  scene.load.spritesheet(LAND_DUST.key, LAND_DUST.file, { frameWidth: LAND_DUST.fw, frameHeight: LAND_DUST.fh });
}

export function defineMovementFXAnimations(scene: Phaser.Scene) {
  const key = `fx-${LAND_DUST.key}`;
  if (scene.anims.exists(key)) return;
  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNumbers(LAND_DUST.key, {
      frames: Array.from({ length: LAND_DUST.frames }, (_, i) => i),
    }),
    frameRate: 30,
    repeat: 0,
  });
}

export class PlayerMovementFX {
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly barBg: Phaser.GameObjects.Rectangle;
  private readonly bar: Phaser.GameObjects.Rectangle;

  constructor(private readonly scene: Phaser.Scene) {
    this.shadow = scene.add.ellipse(0, 0, 20, 8, 0x000000, 0.35).setDepth(1).setVisible(false);
    this.barBg = scene.add.rectangle(0, 0, BAR_W, BAR_H, 0x000000, 0.55).setDepth(3).setVisible(false);
    this.bar = scene.add.rectangle(0, 0, BAR_W, BAR_H, 0x63b3ff).setDepth(3).setVisible(false);
  }

  /** Position the shadow (while airborne) and the cooldown bar (while charging). */
  sync(x: number, y: number, airHeight: number, cooldownFrac: number): void {
    // Ground shadow: only while genuinely aloft (a Vault), shrinking with height.
    if (airHeight > 1) {
      const t = Math.min(1, airHeight / VAULT_PEAK_HEIGHT);
      this.shadow
        .setVisible(true)
        .setPosition(x, y + 14)
        .setScale(1 - 0.4 * t)
        .setAlpha(0.4 - 0.2 * t);
    } else {
      this.shadow.setVisible(false);
    }

    // Cooldown loading bar: fills left→right as the ability recharges, then hides
    // the instant it is ready (frac >= 1). Nothing to show when already ready.
    if (cooldownFrac < 1) {
      const by = y + BAR_DROP;
      const w = Math.max(0.001, BAR_W * cooldownFrac);
      this.barBg.setVisible(true).setPosition(x, by);
      this.bar.setVisible(true).setPosition(x - BAR_W / 2 + w / 2, by);
      this.bar.width = w;
    } else {
      this.barBg.setVisible(false);
      this.bar.setVisible(false);
    }
  }

  /** A one-shot expanding ring when an ability fires, tinted per class. */
  burst(x: number, y: number, abilityId: string): void {
    const color = ABILITY_COLORS[abilityId] ?? 0xffffff;
    const ring = this.scene.add.ellipse(x, y + 8, 12, 7, color, 0.7).setDepth(2);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 260,
      onComplete: () => ring.destroy(),
    });
  }

  /** The Mage Blink's two-ended poof. "leave" collapses inward where the Mage
   *  vanishes; "arrive" bursts outward where it reappears — fired on the synced
   *  blinkHidden going true then false, so a real beat of absence sits between them. */
  blinkPoof(x: number, y: number, kind: "leave" | "arrive"): void {
    const color = ABILITY_COLORS.blink;
    const ring = this.scene.add.ellipse(x, y + 8, 26, 15, color, 0.7).setDepth(2);
    const to = kind === "leave" ? 0.1 : 3;
    this.scene.tweens.add({
      targets: ring,
      scaleX: to,
      scaleY: to,
      alpha: 0,
      duration: 240,
      onComplete: () => ring.destroy(),
    });
  }

  /** A one-shot dust puff at a player's feet, left to finish animating in place.
   *  "charge" is a smaller kick-up stamped once per step along a Knight's Charge
   *  (the wake is many of these); "land" the larger splash where a Ranger's Vault
   *  touches down. Depth 1.5 sits it UNDER the characters (depth 2), so it reads as
   *  ground dust the player runs out ahead of. */
  dust(x: number, y: number, kind: "charge" | "land"): void {
    const sprite = this.scene.add.sprite(x, y + 10, LAND_DUST.key).setDepth(1.5);
    sprite.setScale(kind === "charge" ? 1.1 : 1.6);
    sprite.setFlipX(Math.random() < 0.5);
    sprite.play(`fx-${LAND_DUST.key}`);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
  }

  destroy(): void {
    this.shadow.destroy();
    this.barBg.destroy();
    this.bar.destroy();
  }
}
