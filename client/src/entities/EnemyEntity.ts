import Phaser from "phaser";
import { AiState, Facing, EnemyType, ENEMY_REGISTRY } from "shared";
import { Entity } from "./Entity";
import { isGooType, resolveGooAnim, gooAnimKey } from "./GooSprites";
import { isBatType, batAnimKey, BAT_DISPLAY_SIZE } from "./BatSprites";
import { DebugDrawable, DebugShape, DEBUG_COLORS } from "../debug/DebugDraw";

export class EnemyEntity extends Entity implements DebugDrawable {
  private targetX: number;
  private targetY: number;
  private currentHp: number;
  private facing: Facing = "right";
  private aiState: AiState = "patrol";
  private dying = false;
  private currentEnemyAnim?: string;
  private readonly enemyType: string;

  constructor(scene: Phaser.Scene, x: number, y: number, enemyType: string) {
    const maxHp = ENEMY_REGISTRY[enemyType as EnemyType]?.maxHp ?? 60;
    super(scene, x, y, 0xe53e3e, maxHp);
    if (!(enemyType in ENEMY_REGISTRY)) {
      console.warn(`EnemyEntity: unknown enemy type "${enemyType}" — rendering placeholder rectangle`);
    }
    this.targetX = x;
    this.targetY = y;
    this.currentHp = maxHp;
    this.enemyType = enemyType;

    if (isGooType(enemyType)) {
      this.useRawSprite(enemyType);
    } else if (isBatType(enemyType)) {
      this.useRawSprite(enemyType);
      this.charSprite!.setDisplaySize(BAT_DISPLAY_SIZE, BAT_DISPLAY_SIZE);
    }
    this.sprite.setSize(20, 20);
  }

  setTarget(x: number, y: number, hp: number, facing: Facing, aiState: AiState, isDying: boolean) {
    if (!this.dying) {
      this.targetX = x;
      this.targetY = y;
    }
    this.currentHp = hp;
    this.facing = facing;
    this.aiState = aiState;

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
    }

    if (!this.dying) {
      this.updateHpBar(this.currentHp);
    }
  }

  collectDebugShapes(): DebugShape[] {
    // Corpses don't interact (WALL-only mask on the server) — nothing to show.
    if (this.dying) return [];
    const cfg = ENEMY_REGISTRY[this.enemyType as EnemyType];
    const shapes: DebugShape[] = [this.bodyDebugCircle(DEBUG_COLORS.enemyBody)];
    if (cfg) {
      // Attack/aggro are center-to-center distances (see Enemy AI), so centre
      // them on the sprite, not the feet body.
      const x = this.sprite.x;
      const y = this.sprite.y;
      shapes.push({ kind: "circle", x, y, r: cfg.aggroRadius, color: DEBUG_COLORS.enemyAggro });
      shapes.push({ kind: "circle", x, y, r: cfg.attackRadius, color: DEBUG_COLORS.enemyAttack });
    }
    return shapes;
  }

  private playEnemyAnim() {
    this.charSprite!.setFlipX(this.facing === "left");

    let key: string;
    if (isGooType(this.enemyType)) {
      const clip = resolveGooAnim(this.dying);
      key = gooAnimKey(this.enemyType, clip);
    } else if (isBatType(this.enemyType)) {
      key = this.dying ? batAnimKey("death") : batAnimKey("fly");
    } else {
      return;
    }

    if (this.currentEnemyAnim === key) return;
    this.currentEnemyAnim = key;
    this.charSprite!.play(key);
  }
}
