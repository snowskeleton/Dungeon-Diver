import Phaser from "phaser";
import { TILE_SIZE, Facing, RangedStyle, FOOT_OFFSET, ENTITY_RADIUS, WEAPON_REGISTRY } from "shared";
import type { DebugShape } from "../debug/DebugDraw";
import {
  AttackFXType,
  StripFXType,
  createAttackFXSprite,
  playAttackFX,
  syncAttackFX,
  WEAPON_ICON_DISPLAY_SIZE,
} from "./AttackFXSprites";
import { NovaFX } from "./NovaFX";
import {
  createBowSprite,
  playBowFX,
  syncBowFX,
} from "./RangedWeaponFX";
import {
  createCastSprite,
  playCastFX,
  syncCastFX,
  showHeldStaff,
} from "./CastFX";

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
  private fxSprite?: Phaser.GameObjects.Sprite;
  private fxType?: StripFXType;
  // AOE staves (fxType "nova") render an expanding blast instead of a swing strip.
  private novaFx?: NovaFX;
  private weaponIconImage?: Phaser.GameObjects.Image;
  // Ranged weapons (bows/crossbows) render a draw sheet instead of a melee FX
  // strip + icon. When set, the attack plays this bow sprite's draw clip.
  private bowSprite?: Phaser.GameObjects.Sprite;
  private rangedWeaponId?: string;
  // Staves (rangedStyle "cast"): the icon stays in hand and pulses on each cast.
  private castSprite?: Phaser.GameObjects.Image;
  // Last facing the anim update saw — the held staff needs it every frame, but
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

    this.configureWeaponVisuals(fxType, weaponIconTextureKey, rangedStyle);
  }

  // Builds the per-weapon FX sprites (melee strip + icon, or held-bow draw sprite;
  // thrown weapons have none). Split out of setupCharacter so swapWeapon can rebuild
  // it when the active weapon changes.
  private configureWeaponVisuals(
    fxType: AttackFXType | null,
    weaponIconTextureKey?: string,
    rangedStyle?: RangedStyle,
  ) {
    if (rangedStyle === "held" && weaponIconTextureKey) {
      // Held ranged (bow/crossbow): a 2-frame draw sprite; no melee FX or icon.
      this.rangedWeaponId = weaponIconTextureKey;
      this.bowSprite = createBowSprite(this.scene, weaponIconTextureKey);
      return;
    }
    if (rangedStyle === "cast" && weaponIconTextureKey) {
      // Staff: the single weapon icon is held in hand and animated on cast — no
      // draw sheet needed (see CastFX).
      this.rangedWeaponId = weaponIconTextureKey;
      this.castSprite = createCastSprite(this.scene, weaponIconTextureKey);
      showHeldStaff(this.castSprite, this.sprite.x, this.sprite.y, this.lastFacing);
      return;
    }
    if (rangedStyle === "thrown") {
      // Thrown (knife/star/boomerang): the flying projectile is the whole visual;
      // nothing stays in hand.
      return;
    }

    if (fxType === "nova") {
      // AOE staff: size the blast to the weapon's AoeSpec (weaponIconTextureKey is
      // the weapon id). No in-hand icon or swing strip — the nova is the whole FX.
      const radius = WEAPON_REGISTRY[weaponIconTextureKey ?? ""]?.aoe?.radius ?? 76;
      this.novaFx = new NovaFX(this.scene, radius);
      return;
    }

    if (fxType) {
      this.fxType = fxType;
      this.fxSprite = createAttackFXSprite(this.scene, fxType);
    }
    if (weaponIconTextureKey) {
      this.weaponIconImage = this.scene.add.image(0, 0, weaponIconTextureKey);
      this.weaponIconImage.setOrigin(0.5, 0.5);
      this.weaponIconImage.setDepth(2.6);
      this.weaponIconImage.setDisplaySize(WEAPON_ICON_DISPLAY_SIZE, WEAPON_ICON_DISPLAY_SIZE);
      this.weaponIconImage.setVisible(false);
    }
  }

  // Hot-swap the weapon visuals to a different weapon (inventory switch). Tears
  // down the current FX/icon/bow sprites and rebuilds from the new weapon; the
  // character body sprite is untouched.
  swapWeapon(
    fxType: AttackFXType | null,
    weaponIconTextureKey?: string,
    rangedStyle?: RangedStyle,
  ) {
    this.fxSprite?.destroy();
    this.weaponIconImage?.destroy();
    this.bowSprite?.destroy();
    this.castSprite?.destroy();
    this.novaFx?.destroy();
    this.fxSprite = undefined;
    this.weaponIconImage = undefined;
    this.bowSprite = undefined;
    this.castSprite = undefined;
    this.novaFx = undefined;
    this.fxType = undefined;
    this.rangedWeaponId = undefined;
    this.configureWeaponVisuals(fxType, weaponIconTextureKey, rangedStyle);
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
    if (this.fxSprite) {
      // Keep an in-flight swing anchored to the entity.
      syncAttackFX(this.fxSprite, this.sprite.x, this.sprite.y, this.weaponIconImage);
    }
    if (this.bowSprite) {
      syncBowFX(this.bowSprite, this.sprite.x, this.sprite.y);
    }
    if (this.castSprite) {
      syncCastFX(this.castSprite, this.sprite.x, this.sprite.y, this.lastFacing);
    }
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
    if (this.castSprite) {
      playCastFX(this.castSprite, this.sprite.x, this.sprite.y, facing);
      return;
    }
    if (this.bowSprite && this.rangedWeaponId) {
      playBowFX(this.bowSprite, this.rangedWeaponId, this.sprite.x, this.sprite.y, facing);
      return;
    }
    if (this.novaFx) {
      this.novaFx.play(this.sprite.x, this.sprite.y);
      return;
    }
    if (!this.fxType || !this.fxSprite) return;
    playAttackFX(
      this.fxSprite,
      this.fxType,
      this.sprite.x,
      this.sprite.y,
      facing,
      this.weaponIconImage,
    );
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
    this.fxSprite?.destroy();
    this.weaponIconImage?.destroy();
    this.bowSprite?.destroy();
    this.castSprite?.destroy();
    this.novaFx?.destroy();
    this.hpBar.destroy();
    this.hpBarBg.destroy();
  }
}
