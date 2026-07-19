import Phaser from "phaser";
import { TILE_SIZE, Facing, RangedStyle, FOOT_OFFSET, ENTITY_RADIUS, WEAPON_REGISTRY } from "shared";
import type { DebugShape } from "../debug/DebugDraw";
import { AttackFXType } from "./AttackFXSprites";
import { WeaponVisual, createWeaponVisual, createNoWeaponVisual } from "./WeaponVisuals";

const HP_BAR_W = 24;
const HP_BAR_H = 4;

export type CharacterAction = "idle" | "walk" | "attack";

export interface CharacterSpriteConfig {
  textureKey: string;
  /** When true, Entity mirrors the sprite via flipX for left-facing (sheet has no left row).
   *  When false, the sheet has a dedicated left row and no flip is applied. */
  usesFlipX: boolean;
  /** Returns the full Phaser animation key for the given action+facing. */
  resolveAnim: (action: CharacterAction, facing: Facing) => string;
  /** Returns the full Phaser animation key for the hurt-flash clip. */
  hurtAnim: (facing: Facing) => string;
}

export abstract class Entity {
  sprite: Phaser.GameObjects.Rectangle;
  protected charSprite?: Phaser.GameObjects.Sprite;
  private spriteConfig?: CharacterSpriteConfig;
  private currentAnimKey?: string;
  private wasAttacking = false;
  private attackAnimDone = false;
  private lastHp?: number;
  private isHurt = false;
  // How the active weapon looks — one object per style (melee swing, held bow,
  // held staff, nova, or none for thrown). See WeaponVisuals.ts.
  private weaponVisual: WeaponVisual = createNoWeaponVisual();
  // Last facing the anim update saw — a held staff needs it every frame, but
  // syncSpritePosition() runs outside the anim path where facing is passed in.
  private lastFacing: Facing = "down";
  protected hpBar: Phaser.GameObjects.Rectangle;
  protected hpBarBg: Phaser.GameObjects.Rectangle;
  protected scene: Phaser.Scene;
  protected maxHp: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    color: number,
    maxHp: number,
  ) {
    this.scene = scene;
    this.maxHp = maxHp;

    this.sprite = scene.add.rectangle(x, y, TILE_SIZE - 4, TILE_SIZE - 4, color);
    this.sprite.setDepth(2);

    this.hpBarBg = scene.add.rectangle(x, y - 18, HP_BAR_W, HP_BAR_H, 0x222222);
    this.hpBarBg.setDepth(3);
    this.hpBar = scene.add.rectangle(x, y - 18, HP_BAR_W, HP_BAR_H, 0x48bb78);
    this.hpBar.setDepth(3);
  }

  // The server's collision body: a circle of ENTITY_RADIUS at the sprite's feet
  // (see PhysicsWorld). Shared by the player/enemy debug overlays.
  protected bodyDebugCircle(color: number): DebugShape {
    return {
      kind: "circle",
      x: this.sprite.x,
      y: this.sprite.y + FOOT_OFFSET,
      r: ENTITY_RADIUS,
      color,
    };
  }

  // Sets up a sprite without a CharacterSpriteConfig — for entities that drive
  // their own animation (e.g. EnemyEntity with its slime anim system).
  protected useRawSprite(textureKey: string) {
    this.sprite.setVisible(false);
    this.charSprite = this.scene.add.sprite(this.sprite.x, this.sprite.y, textureKey);
    this.charSprite.setDepth(2);
    this.charSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
  }

  // Sets up the character sprite and optional attack FX. Call once after construction.
  // weaponIconTextureKey: texture key already loaded by GameScene.preload() for this weapon.
  // The icon's per-frame position and rotation come from the FX keyframes in
  // AttackFXSprites.ts, so it needs no per-weapon angle.
  setupCharacter(
    spriteCfg: CharacterSpriteConfig,
    fxType: AttackFXType | null = null,
    weaponIconTextureKey?: string,
    rangedStyle?: RangedStyle,
  ) {
    this.spriteConfig = spriteCfg;
    this.sprite.setVisible(false);
    this.charSprite = this.scene.add.sprite(this.sprite.x, this.sprite.y, spriteCfg.textureKey);
    this.charSprite.setDepth(2);
    this.charSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);

    this.weaponVisual = this.buildWeaponVisual(fxType, weaponIconTextureKey, rangedStyle);
  }

  private buildWeaponVisual(
    fxType: AttackFXType | null,
    weaponIconTextureKey?: string,
    rangedStyle?: RangedStyle,
  ): WeaponVisual {
    return createWeaponVisual(
      this.scene,
      fxType,
      weaponIconTextureKey,
      rangedStyle,
      this.sprite.x,
      this.sprite.y,
      this.lastFacing,
    );
  }

  // Hot-swap the weapon visuals to a different weapon (inventory switch). The
  // character body sprite is untouched.
  swapWeapon(
    fxType: AttackFXType | null,
    weaponIconTextureKey?: string,
    rangedStyle?: RangedStyle,
  ) {
    this.weaponVisual.destroy();
    this.weaponVisual = this.buildWeaponVisual(fxType, weaponIconTextureKey, rangedStyle);
  }

  // Clears the attack edge-detect state so the next "attack" action restarts the
  // one-shot clip — needed when the server signals a new swing (attackSeq change)
  // while isAttacking never dropped to false (held attack key).
  protected retriggerAttack() {
    this.wasAttacking = false;
  }

  protected playAnim(action: CharacterAction, facing: Facing) {
    if (!this.charSprite || !this.spriteConfig) return;
    this.syncSpritePosition();

    if (this.playHurtFlash(facing)) return;

    const startedAttack = action === "attack" && !this.wasAttacking;
    const effective = this.resolveEffectiveAction(action, startedAttack);

    this.charSprite.setFlipX(this.spriteConfig!.usesFlipX && facing === "left");
    this.lastFacing = facing;
    this.setAnim(this.spriteConfig.resolveAnim(effective, facing), startedAttack);
    this.updateAttackFX(startedAttack, facing);
  }

  private syncSpritePosition() {
    this.charSprite!.x = this.sprite.x;
    this.charSprite!.y = this.sprite.y;
    // Uses lastFacing, not the facing being applied this frame — same as before
    // the visuals were unified, since sync runs at the top of playAnim.
    this.weaponVisual.sync(this.sprite.x, this.sprite.y, this.lastFacing);
  }

  private playHurtFlash(facing: Facing): boolean {
    if (!this.isHurt) return false;
    this.charSprite!.setFlipX(this.spriteConfig!.usesFlipX && facing === "left");
    const key = this.spriteConfig!.hurtAnim(facing);
    if (this.currentAnimKey !== key) {
      this.currentAnimKey = key;
      this.charSprite!.play(key);
    } else if (!this.charSprite!.anims.isPlaying) {
      this.isHurt = false;
    }
    return this.isHurt;
  }

  private resolveEffectiveAction(action: CharacterAction, startedAttack: boolean): CharacterAction {
    if (startedAttack) this.attackAnimDone = false;
    else if (action === "attack" && !this.charSprite!.anims.isPlaying) this.attackAnimDone = true;
    this.wasAttacking = action === "attack";
    return action === "attack" && this.attackAnimDone ? "idle" : action;
  }

  private setAnim(key: string, forceRestart: boolean) {
    if (this.currentAnimKey === key && !forceRestart) return;
    this.currentAnimKey = key;
    this.charSprite!.play(key);
  }

  private updateAttackFX(startedAttack: boolean, facing: Facing) {
    if (!startedAttack) return;
    this.weaponVisual.playAttack(this.sprite.x, this.sprite.y, facing);
  }

  updateHpBar(hp: number) {
    if (!this.isHurt && this.lastHp !== undefined && hp < this.lastHp) {
      this.isHurt = true;
    }
    this.lastHp = hp;

    const ratio = Math.max(0, hp / this.maxHp);
    this.hpBar.width = HP_BAR_W * ratio;
    this.hpBar.setFillStyle(ratio > 0.5 ? 0x48bb78 : ratio > 0.25 ? 0xed8936 : 0xe53e3e);
    this.repositionHpBar(ratio);
  }

  private repositionHpBar(ratio: number) {
    this.hpBar.x = this.sprite.x - HP_BAR_W / 2 + (HP_BAR_W * ratio) / 2;
    this.hpBar.y = this.sprite.y - 18;
    this.hpBarBg.x = this.sprite.x;
    this.hpBarBg.y = this.sprite.y - 18;
  }

  setPosition(x: number, y: number) {
    this.sprite.x = x;
    this.sprite.y = y;
    const ratio = this.lastHp !== undefined ? Math.max(0, this.lastHp / this.maxHp) : 1;
    this.repositionHpBar(ratio);
  }

  destroy() {
    this.sprite.destroy();
    this.charSprite?.destroy();
    this.weaponVisual.destroy();
    this.hpBar.destroy();
    this.hpBarBg.destroy();
  }
}
