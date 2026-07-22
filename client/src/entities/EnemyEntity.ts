import Phaser from "phaser";
import { AiState, Facing, EnemyType, EnemyStateView, ENEMY_HURT_BOUNDS } from "shared";
import { Entity } from "./Entity";
import { CLIENT_ENEMY_REGISTRY, ClientEnemyDef } from "../enemies";
import { DebugDrawable, DebugShape, DEBUG_COLORS, hurtBoxShape } from "../debug/DebugDraw";

export class EnemyEntity extends Entity implements DebugDrawable {
  private targetX: number;
  private targetY: number;
  private currentHp: number;
  private facing: Facing = "right";
  private aiState: AiState = "patrol";
  private dying = false;
  private telegraphing = false;
  private telegraphT = 0;
  // Bosses only: which ability is actively channelling (drives the spin clip).
  private channeling = false;
  private abilityId = "";
  // Flying enemies: airborne height in px (server-synced). The sprite is drawn
  // lifted by this and a shadow scaled beneath it (the airborne illusion).
  private airHeight = 0;
  private shadow?: Phaser.GameObjects.Ellipse;
  private currentEnemyAnim?: string;
  private readonly enemyType: string;
  private readonly aggroRadius: number;
  private readonly attackRadius: number;
  private readonly visual?: ClientEnemyDef;

  // maxHp/aggroRadius/attackRadius are synced from the server (EnemyState) — the
  // enemy classes live server-side, so the client carries no copy of their stats.
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    enemyType: string,
    maxHp: number,
    aggroRadius: number,
    attackRadius: number,
  ) {
    super(scene, x, y, 0xe53e3e, maxHp || 60);
    this.visual = CLIENT_ENEMY_REGISTRY[enemyType as EnemyType];
    if (!this.visual) {
      console.warn(`EnemyEntity: unknown enemy type "${enemyType}" — rendering placeholder rectangle`);
    }
    this.targetX = x;
    this.targetY = y;
    this.currentHp = maxHp || 60;
    this.enemyType = enemyType;
    this.aggroRadius = aggroRadius;
    this.attackRadius = attackRadius;

    if (this.visual) {
      this.useRawSprite(this.visual.textureKey);
      this.charSprite!.setDisplaySize(this.visual.displayW, this.visual.displayH);
    }
    this.sprite.setSize(20, 20);
  }

  /** Take the whole synced enemy and read what this view needs. Adding a synced
   *  field is now a one-line change here, not a new positional parameter
   *  threaded through GameScene's onChange wiring. */
  setTarget(state: EnemyStateView) {
    if (!this.dying) {
      this.targetX = state.x;
      this.targetY = state.y;
    }
    this.currentHp = state.health;
    this.facing = state.facing;
    this.aiState = state.aiState;
    this.telegraphing = state.telegraph;
    this.channeling = state.channeling;
    this.abilityId = state.abilityId;
    this.airHeight = state.airHeight;

    if (state.isDying && !this.dying) {
      this.dying = true;
      this.charSprite?.setDepth(1);
      this.hpBar.setVisible(false);
      this.hpBarBg.setVisible(false);
      this.playDeathFlourish();
    } else if (!state.isDying && this.dying) {
      // Revive (only the debug respawn does this today) has to undo every part of
      // the flourish, tweens included, or the enemy comes back invisible.
      this.dying = false;
      this.currentEnemyAnim = undefined;
      if (this.charSprite) this.scene.tweens.killTweensOf(this.charSprite);
      this.scene.tweens.killTweensOf(this);
      this.deathLift = 0;
      this.charSprite?.setDepth(2);
      this.charSprite?.setAlpha(1);
      this.charSprite?.clearTint();
      if (this.charSprite && this.livingScale) {
        this.charSprite.setScale(this.livingScale.x, this.livingScale.y);
      }
      this.hpBar.setVisible(true);
      this.hpBarBg.setVisible(true);
    }
  }

  /**
   * The universal death read: a white flash, then fade out while drifting up and
   * swelling slightly.
   *
   * Every enemy gets this REGARDLESS of its death clip, because the per-enemy
   * clips can't be relied on — `makeSheetEnemyDef` defaults `death` to the walk
   * frames reversed, which for most creatures is indistinguishable from standing
   * still, and the tester duly reported that "several of them just kinda stop
   * moving when they're dead" (playtest B11). A creature dying is the single most
   * important thing the game has to communicate, so it can't be left to whether
   * someone authored a clip for that sheet.
   *
   * The corpse lingers server-side (see Enemy.takeHit) — this is purely the view.
   */
  private playDeathFlourish() {
    const sprite = this.charSprite;
    if (!sprite) return;

    this.livingScale = { x: sprite.scaleX, y: sprite.scaleY };
    sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => {
      if (!this.isDestroyed) sprite.clearTint();
    });

    this.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      scaleX: sprite.scaleX * 1.25,
      scaleY: sprite.scaleY * 1.25,
      duration: 620,
      delay: 90,
      ease: "Quad.easeOut",
    });

    // The upward drift goes through a field rather than tweening sprite.y:
    // update() reassigns that every frame from the interpolated body position,
    // and would simply overwrite a positional tween.
    this.scene.tweens.add({
      targets: this,
      deathLift: 10,
      duration: 620,
      delay: 90,
      ease: "Quad.easeOut",
    });
  }

  /** Extra px the corpse has drifted upward during its death flourish. */
  private deathLift = 0;
  /** Sprite scale before the flourish swelled it, so a revive can restore it. */
  private livingScale?: { x: number; y: number };

  update() {
    if (!this.dying) {
      this.sprite.x += (this.targetX - this.sprite.x) * 0.25;
      this.sprite.y += (this.targetY - this.sprite.y) * 0.25;
    }

    if (this.charSprite) {
      this.charSprite.x = this.sprite.x;
      // Lift the sprite by its airborne height; the ground point (sprite.x/y,
      // where the shadow and the server hitbox sit) stays put.
      this.charSprite.y = this.sprite.y - this.airHeight - this.deathLift;
      this.playEnemyAnim();
      this.updateTelegraph();
      this.updateShadow();
    }

    if (!this.dying) {
      this.updateHpBar(this.currentHp);
      // Float the HP bar up with the lifted sprite so it stays readable overhead.
      this.hpBar.y -= this.airHeight;
      this.hpBarBg.y -= this.airHeight;
    }
  }

  // A flat shadow on the ground under any flying enemy (bat, floater, wyvern):
  // biggest and darkest at the floor (airHeight 0), shrinking and fading with
  // height. The falloff is in absolute px so it works for any flyer's altitude
  // without needing to know its cruise height.
  private updateShadow() {
    if (!this.visual?.airborne) return;
    if (!this.shadow) {
      const w = this.visual.displayW * 0.55;
      this.shadow = this.scene.add.ellipse(this.sprite.x, this.sprite.y, w, w * 0.42, 0x000000, 0.4);
      this.shadow.setDepth(1);
    }
    // Only cast a shadow while actually aloft. True flyers cruise above 0 so it's
    // always shown for them; a mostly-grounded flyer (the Tengu, airborne only for
    // its Stone Crash) gets a shadow just for the dive, not while it stands.
    if (this.dying || this.airHeight < 1) {
      this.shadow.setVisible(false);
      return;
    }
    const h = Math.max(0, this.airHeight);
    const t = h / (h + 60); // 0 at the floor → approaches 1 with height
    this.shadow.setVisible(true);
    this.shadow.setScale(1 - 0.4 * t);
    this.shadow.setAlpha(0.5 - 0.28 * t);
    this.shadow.setPosition(this.sprite.x, this.sprite.y + this.visual.displayH * 0.2);
  }

  // A boss winding up an attack pulses bright red — the readable "tell" a player
  // reacts to (docs/bosses.md). Cleared the moment the strike fires.
  private updateTelegraph() {
    if (!this.charSprite) return;
    if (this.telegraphing && !this.dying) {
      this.telegraphT += 0.2;
      const pulse = 0.5 + 0.5 * Math.sin(this.telegraphT * Math.PI); // 0→1→0
      // White → red: green/blue fall off as the pulse rises, red stays full.
      const gb = Math.round(255 + (60 - 255) * pulse);
      this.charSprite.setTint(Phaser.Display.Color.GetColor(255, gb, gb));
    } else if (this.telegraphT !== 0) {
      this.telegraphT = 0;
      this.charSprite.clearTint();
    }
  }

  collectDebugShapes(): DebugShape[] {
    // Corpses don't interact (WALL-only mask on the server) — nothing to show.
    if (this.dying) return [];
    const shapes: DebugShape[] = [this.bodyDebugCircle(DEBUG_COLORS.enemyBody)];
    // Attack/aggro are center-to-center distances (see Enemy AI), so centre them
    // on the sprite, not the feet body. Radii are synced from the server.
    const x = this.sprite.x;
    const y = this.sprite.y;
    if (this.aggroRadius > 0) shapes.push({ kind: "circle", x, y, r: this.aggroRadius, color: DEBUG_COLORS.enemyAggro });
    if (this.attackRadius > 0) shapes.push({ kind: "circle", x, y, r: this.attackRadius, color: DEBUG_COLORS.enemyAttack });
    shapes.push(hurtBoxShape(ENEMY_HURT_BOUNDS[this.enemyType as EnemyType], x, y));
    return shapes;
  }

  private playEnemyAnim() {
    if (!this.visual) return;

    // The def picks the clip (or a static frame) from the full render state:
    // directional art keys off facing (never mirrored), bosses off their ability,
    // and a flying boss's dive off its airHeight.
    const clip = this.visual.resolve({
      isDying: this.dying,
      facing: this.facing,
      telegraph: this.telegraphing,
      channeling: this.channeling,
      abilityId: this.abilityId,
      airHeight: this.airHeight,
    });
    this.charSprite!.setFlipX(clip.flipX);

    // A static frame (the wyvern's dive, driven by airHeight) holds an exact frame
    // instead of running a clip; force the next clip to replay when we return to one.
    if (clip.frame !== undefined) {
      this.charSprite!.anims.stop();
      this.charSprite!.setFrame(clip.frame);
      this.currentEnemyAnim = undefined;
      return;
    }

    if (this.currentEnemyAnim === clip.key) return;
    this.currentEnemyAnim = clip.key;
    this.charSprite!.play(clip.key);
  }

  override destroy() {
    // The death flourish's tweens hold this view and its sprite; a floor change
    // can remove the enemy mid-fade, and a tween left running would keep writing
    // to a destroyed sprite.
    if (this.charSprite) this.scene.tweens.killTweensOf(this.charSprite);
    this.scene.tweens.killTweensOf(this);
    this.shadow?.destroy();
    super.destroy();
  }
}
