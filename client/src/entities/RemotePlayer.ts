import Phaser from "phaser";
import {
  CharacterClass, CharacterType, getCharacterConfig, WeaponId, Weapon, WEAPON_REGISTRY,
  Facing, PlayerStateView,
} from "shared";
import { Entity } from "./Entity";
import { CLIENT_CHARACTER_VISUAL_REGISTRY } from "../characters";
import { DebugDrawable, DebugShape, DEBUG_COLORS } from "../debug/DebugDraw";
import { meleeHurtboxShapes } from "../debug/hurtboxShapes";

export class RemotePlayer extends Entity implements DebugDrawable {
  private targetX: number;
  private targetY: number;
  private currentHp: number;
  private facing: Facing = "down";
  private isAttacking = false;
  private lastAttackSeq = -1;
  private pendingSnap = false;
  private weapon?: Weapon;
  private activeWeaponId?: string;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    characterClass: CharacterClass = "knight",
    characterType: CharacterType = "guy",
    weaponId?: string,
  ) {
    const cfg = getCharacterConfig(characterClass);
    const visualDef = CLIENT_CHARACTER_VISUAL_REGISTRY[characterType];
    const resolvedWeaponId = (weaponId ?? cfg.defaultWeaponId) as WeaponId;
    const weapon = WEAPON_REGISTRY[resolvedWeaponId];
    super(scene, x, y, 0x9f7aea, cfg.maxHp);
    this.targetX = x;
    this.targetY = y;
    this.currentHp = cfg.maxHp;
    this.weapon = weapon;
    this.activeWeaponId = weapon?.id;
    this.setupCharacter(visualDef.spriteConfig, weapon?.fxType ?? null, weapon?.id, weapon?.rangedStyle);
  }

  setTarget(state: PlayerStateView) {
    const { weaponId, attackSeq } = state;
    this.targetX = state.x;
    this.targetY = state.y;
    this.currentHp = state.health;
    this.facing = state.facing;
    this.isAttacking = state.isAttacking;
    // Active weapon changed on the server — hot-swap the visuals to match.
    if (weaponId && weaponId !== this.activeWeaponId) {
      const w = WEAPON_REGISTRY[weaponId as WeaponId];
      if (w) {
        this.activeWeaponId = weaponId;
        this.weapon = w;
        this.swapWeapon(w.fxType, w.id, w.rangedStyle);
      }
    }
    if (attackSeq !== this.lastAttackSeq) {
      if (this.lastAttackSeq !== -1) this.retriggerAttack();
      this.lastAttackSeq = attackSeq;
    }
    if (this.pendingSnap) {
      this.pendingSnap = false;
      this.setPosition(state.x, state.y);
    }
  }

  snapOnNextTarget() {
    this.pendingSnap = true;
  }

  update() {
    const dx = this.targetX - this.sprite.x;
    const dy = this.targetY - this.sprite.y;
    this.sprite.x += dx * 0.3;
    this.sprite.y += dy * 0.3;
    this.updateHpBar(this.currentHp);

    const isMoving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    this.playAnim(this.isAttacking ? "attack" : isMoving ? "walk" : "idle", this.facing);
  }

  collectDebugShapes(): DebugShape[] {
    const shapes = [this.bodyDebugCircle(DEBUG_COLORS.playerBody)];
    if (this.weapon) {
      shapes.push(
        ...meleeHurtboxShapes(this.weapon, this.sprite.x, this.sprite.y, this.facing, this.isAttacking),
      );
    }
    return shapes;
  }
}
