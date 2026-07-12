import Phaser from "phaser";
import { AiState, Facing, EnemyType } from "shared";
import { Entity } from "./Entity";
import { CLIENT_ENEMY_REGISTRY, ClientEnemyDef } from "../enemies";
import { DebugDrawable, DebugShape, DEBUG_COLORS } from "../debug/DebugDraw";

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
  private currentEnemyAnim?: string;
  private readonly enemyType: string;
  private readonly aggroRadius: number;
  private readonly attackRadius: number;
  private readonly visual?: ClientEnemyDef;

  // maxHp/aggroRadius/attackRadius are synced from the server (EnemyState) — the
  // enemy classes live server-side, so the client carries no copy of their stats.
  constructor(scene: Phaser.Scene, x: number, y: number, enemyType: string, maxHp: number, aggroRadius: number, attackRadius: number) {
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

  setTarget(x: number, y: number, hp: number, facing: Facing, aiState: AiState, isDying: boolean, telegraph = false, channeling = false, abilityId = "") {
    if (!this.dying) {
      this.targetX = x;
      this.targetY = y;
    }
    this.currentHp = hp;
    this.facing = facing;
    this.aiState = aiState;
    this.telegraphing = telegraph;
    this.channeling = channeling;
    this.abilityId = abilityId;

    if (isDying && !this.dying) {
      this.dying = true;
      this.charSprite?.setDepth(1);
      this.hpBar.setVisible(false);
      this.hpBarBg.setVisible(false);
    } else if (!isDying && this.dying) {
      this.dying = false;
      this.currentEnemyAnim = undefined;
      this.charSprite?.setDepth(2);
      this.hpBar.setVisible(true);
      this.hpBarBg.setVisible(true);
    }
  }

  update() {
    if (!this.dying) {
      this.sprite.x += (this.targetX - this.sprite.x) * 0.25;
      this.sprite.y += (this.targetY - this.sprite.y) * 0.25;
    }

    if (this.charSprite) {
      this.charSprite.x = this.sprite.x;
      this.charSprite.y = this.sprite.y;
      this.playEnemyAnim();
      this.updateTelegraph();
    }

    if (!this.dying) {
      this.updateHpBar(this.currentHp);
    }
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
    return shapes;
  }

  private playEnemyAnim() {
    if (!this.visual) return;

    // Directional art has a row per facing and must never be mirrored; the
    // def decides, since only it knows which layout the sheet uses. A boss
    // mid-channel passes its abilityId so the def can swap to an action clip.
    const action = this.channeling ? this.abilityId : undefined;
    const { key, flipX } = this.visual.resolve(this.dying, this.facing, action);
    this.charSprite!.setFlipX(flipX);

    if (this.currentEnemyAnim === key) return;
    this.currentEnemyAnim = key;
    this.charSprite!.play(key);
  }
}
