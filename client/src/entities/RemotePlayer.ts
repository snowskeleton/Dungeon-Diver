import Phaser from "phaser";
import {
  CharacterClass, CharacterType, getCharacter, Weapon, resolveWeapon,
  Facing, PlayerStateView, PLAYER_HURT_BOUNDS,
} from "shared";
import { Entity } from "./Entity";
import { CLIENT_CHARACTER_VISUAL_REGISTRY } from "../characters";
import { DebugDrawable, DebugShape, DEBUG_COLORS, hurtBoxShape } from "../debug/DebugDraw";
import { meleeHurtboxShapes } from "../debug/hurtboxShapes";
import { meleeWindupPose } from "./meleeWindupPose";

// How far in the past a remote player is rendered. Interpolation needs two samples
// bracketing the render time; at the 20 Hz sim cadence (50ms) two ticks (100ms) always
// gives a bracketing pair with margin for 60 Hz patch jitter. Remote players are pure
// upside here — a small constant trail is invisible and standard, and it's what removes
// the stop-overshoot drift entirely (we never project past a real sample).
const REMOTE_PLAYER_INTERP_MS = 100;

export class RemotePlayer extends Entity implements DebugDrawable {
  private targetX: number;
  private targetY: number;
  private currentHp: number;
  private facing: Facing = "down";
  private isAttacking = false;
  /** When the current swing's animation began (performance.now()), so the debug
   *  overlay can ask the weapon for the hurtbox of the frame on screen right now.
   *  -Infinity until the first swing, which reads as "animation long over". */
  private swingStartedAt = -Infinity;
  // Mid melee wind-up — suppresses the debug hurtbox and marks the swing arc's clock restart.
  private windingUp = false;
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
    const character = getCharacter(characterClass);
    const visualDef = CLIENT_CHARACTER_VISUAL_REGISTRY[characterType];
    // May be empty until the player claims their first supply-room weapon — then
    // `weapon` is undefined and setupCharacter renders no weapon (NoVisual).
    const weapon = weaponId ? resolveWeapon(weaponId) : undefined;
    super(scene, x, y, 0x9f7aea, character.maxHp);
    this.targetX = x;
    this.targetY = y;
    this.currentHp = character.maxHp;
    this.weapon = weapon;
    this.activeWeaponId = weapon?.id;
    this.setupCharacter(visualDef.spriteConfig, weapon?.fxType ?? null, weapon?.id, weapon?.rangedStyle);
  }

  setTarget(state: PlayerStateView) {
    if (this.isDestroyed) return;
    const { weaponId, attackSeq } = state;
    this.targetX = state.x;
    this.targetY = state.y;
    this.posBuffer.push(state.x, state.y, performance.now());
    this.currentHp = state.health;
    // Follow the synced max HP so upgrades move the bar's full mark (see LocalPlayer).
    if (state.maxHp) this.maxHp = state.maxHp;
    this.facing = state.facing;
    this.isAttacking = state.isAttacking;
    this.setDowned(state.downed);
    this.ingestMovementState(state);
    // The active weapon's tint rides on its slot (a rolled modifier's colour), not on
    // the base template — read it from the active slot so the held icon matches.
    const activeSlot = state.weapons.at(state.activeWeaponIndex);
    const tint = activeSlot && activeSlot.tint >= 0 ? activeSlot.tint : null;
    // Active weapon changed on the server — hot-swap the visuals to match.
    if (weaponId && weaponId !== this.activeWeaponId) {
      const w = resolveWeapon(weaponId);
      if (w) {
        this.activeWeaponId = weaponId;
        this.weapon = w;
        this.swapWeapon(w.fxType, w.id, w.rangedStyle, tint);
      }
    } else {
      // Same base weapon, but a mod may have recoloured the instance in hand.
      this.setWeaponTint(tint);
    }
    if (attackSeq !== this.lastAttackSeq) {
      this.setPendingComboSwing(weaponId, state.comboStep, state.hardSwing);
      if (this.lastAttackSeq !== -1) this.retriggerAttack();
      this.lastAttackSeq = attackSeq;
      this.swingStartedAt = performance.now();
    }
    if (this.weapon) this.setChargePose(...meleeWindupPose(state, this.weapon));
    // The swing arc's animation clock starts at the STRIKE (end of the wind-up), so
    // the debug hurtbox lines up with the frame the resolver hit against.
    const wasWindingUp = this.windingUp;
    this.windingUp = state.windingUp;
    if (wasWindingUp && !this.windingUp) this.swingStartedAt = performance.now();
    if (this.pendingSnap) {
      this.pendingSnap = false;
      // A hard cut (floor change / re-add): drop history and jump, so interpolation
      // doesn't lerp across the teleport gap.
      this.posBuffer.reset(state.x, state.y, performance.now());
      this.setPosition(state.x, state.y);
    }
  }

  snapOnNextTarget() {
    this.pendingSnap = true;
  }

  update() {
    // Render slightly in the past, interpolating between received samples — never
    // projecting forward, so a stop lands exactly on the last sample instead of coasting
    // past it. Assign directly: interpolation is already the smoothing (no extra lerp).
    const goal = this.interpolatedGoal(performance.now(), REMOTE_PLAYER_INTERP_MS);
    const dx = goal.x - this.sprite.x;
    const dy = goal.y - this.sprite.y;
    this.sprite.x = goal.x;
    this.sprite.y = goal.y;
    this.updateHpBar(this.currentHp);

    const isMoving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    this.playAnim(this.isAttacking ? "attack" : isMoving ? "walk" : "idle", this.facing);
    this.renderMovementFX();
  }

  collectDebugShapes(): DebugShape[] {
    const shapes = [
      this.bodyDebugCircle(DEBUG_COLORS.playerBody),
      hurtBoxShape(PLAYER_HURT_BOUNDS, this.sprite.x, this.sprite.y),
    ];
    if (this.weapon && !this.windingUp) {
      shapes.push(
        ...meleeHurtboxShapes(this.weapon, this.sprite.x, this.sprite.y, this.facing, performance.now() - this.swingStartedAt),
      );
    }
    return shapes;
  }
}
