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

  destroy(): void {
    this.shadow.destroy();
    this.barBg.destroy();
    this.bar.destroy();
  }
}
