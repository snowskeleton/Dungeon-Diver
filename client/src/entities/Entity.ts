import Phaser from "phaser";
import { TILE_SIZE, Facing, RangedStyle, FOOT_OFFSET, ENTITY_RADIUS, resolveWeapon, ComboSwing } from "shared";
import { DEBUG_COLORS, type DebugShape } from "../debug/DebugDraw";
import { AttackFXType } from "./AttackFXSprites";
import { WeaponVisual, createWeaponVisual, createNoWeaponVisual } from "./WeaponVisuals";
import { PlayerMovementFX } from "./PlayerMovementFX";

const HP_BAR_W = 24;
const HP_BAR_H = 4;

// Spacing (px of travel) between dust puffs stamped along a Knight's Charge — small
// enough to read as a continuous trail, large enough that they don't overlap into
// one blob. Roughly half a tile.
const CHARGE_DUST_STEP = 14;

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
    tint: number | null = null,
  ) {
    this.spriteConfig = spriteCfg;
    this.sprite.setVisible(false);
    this.charSprite = this.scene.add.sprite(this.sprite.x, this.sprite.y, spriteCfg.textureKey);
    this.charSprite.setDepth(2);
    this.charSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);

    this.weaponTint = tint;
    this.weaponVisual = this.buildWeaponVisual(fxType, weaponIconTextureKey, rangedStyle);
    this.weaponVisual.setTint?.(this.weaponTint);
  }

  /** The active weapon-instance tint (a rolled modifier's colour), re-applied every
   *  time the weapon visual is (re)built so a swap never loses it. null = no tint. */
  protected weaponTint: number | null = null;

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
    tint: number | null = null,
  ) {
    this.weaponVisual.destroy();
    this.weaponTint = tint;
    this.weaponVisual = this.buildWeaponVisual(fxType, weaponIconTextureKey, rangedStyle);
    this.weaponVisual.setTint?.(this.weaponTint);
  }

  /** Recolour the held weapon in place (a rolled tint on the weapon already in hand),
   *  remembering it so a later rebuild keeps it. Cheaper than a full swap. */
  protected setWeaponTint(tint: number | null): void {
    if (tint === this.weaponTint) return;
    this.weaponTint = tint;
    this.weaponVisual.setTint?.(tint);
  }

  // Clears the attack edge-detect state so the next "attack" action restarts the
  // one-shot clip — needed when the server signals a new swing (attackSeq change)
  // while isAttacking never dropped to false (held attack key).
  protected retriggerAttack() {
    this.wasAttacking = false;
  }

  /** Resolve the swing for a synced (weaponId, comboStep, hard) into pendingComboSwing,
   *  so the next attack FX draws the matching strip + mirror. Call before retrigger. */
  protected setPendingComboSwing(weaponId: string, comboStep: number, hard: boolean) {
    const w = resolveWeapon(weaponId);
    if (hard) {
      this.pendingComboSwing = w?.hardSwing ?? null;
      return;
    }
    const swings = w?.comboSwings;
    this.pendingComboSwing = swings ? swings[comboStep % swings.length] ?? null : null;
  }

  // Deferred-melee wind-up pose: while charging, the subclass sets this from the
  // synced charging/chargeHard flags and playAnim holds the swing's first frame.
  private chargeActive = false;
  private chargeHardPose = false;
  private chargeWasTinted = false;
  private chargeSwing: ComboSwing | null = null;

  /** Set (or clear) the charging wind-up pose. `swing` hints which swing is being
   *  wound up so the cocked-back icon matches (hard vs combo). */
  protected setChargePose(active: boolean, hard: boolean, swing: ComboSwing | null) {
    this.chargeActive = active;
    this.chargeHardPose = hard;
    this.chargeSwing = swing;
  }

  /** Hold the first frame of the attack animation (the wind-up) while charging,
   *  with the weapon cocked back and a warm tint once the hard swing is armed. */
  private renderChargePose(facing: Facing) {
    if (!this.charSprite || !this.spriteConfig) return;
    this.charSprite.setFlipX(this.spriteConfig.usesFlipX && facing === "left");
    const key = this.spriteConfig.resolveAnim("attack", facing);
    const anim = this.scene.anims.get(key);
    this.charSprite.anims.stop();
    const f0 = anim?.frames[0];
    if (f0) this.charSprite.setTexture(f0.textureKey, f0.textureFrame);
    // Force the next real clip to replay (this static frame isn't a played anim).
    this.currentAnimKey = undefined;
    if (this.chargeHardPose) {
      this.charSprite.setTint(0xffcc66);
      this.chargeWasTinted = true;
    } else if (!this.downedShown) {
      this.charSprite.clearTint();
    }
    this.weaponVisual.showWindup(this.sprite.x, this.sprite.y, facing, this.chargeSwing);
    this.lastFacing = facing;
  }

  protected playAnim(action: CharacterAction, facing: Facing) {
    if (!this.charSprite || !this.spriteConfig) return;
    this.syncSpritePosition();

    if (this.playHurtFlash(facing)) return;

    // A charging wind-up holds the swing's first frame and takes over the sprite.
    if (this.chargeActive) {
      this.renderChargePose(facing);
      return;
    }
    // Leaving a hard-charge: drop the warm tint (downed keeps its own).
    if (this.chargeWasTinted && !this.downedShown) {
      this.charSprite.clearTint();
      this.chargeWasTinted = false;
    }

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

  // The combo swing the next attack visual should draw, set by a player subclass
  // from the synced comboStep just before it retriggers. Null = default first swing
  // (enemies, or a weapon with no combo).
  protected pendingComboSwing: ComboSwing | null = null;

  private updateAttackFX(startedAttack: boolean, facing: Facing) {
    if (!startedAttack) return;
    this.weaponVisual.playAttack(this.sprite.x, this.sprite.y, facing, this.pendingComboSwing);
  }

  // ── Class movement ability visuals (players only) ────────────────────────────
  // Lazily created — enemies never call the ingest/render hooks below, so they pay
  // nothing. The player subclasses feed the synced movement fields in from their
  // state ingest and render the shadow / cooldown bar / air-lift each frame.
  private moveFx?: PlayerMovementFX;
  private movementAirHeight = 0;
  private movementCooldownFrac = 1;
  private lastAbilitySeq = -1;
  private movementAbilityId = "";
  // Blink absence: the last synced blinkHidden, so a rising edge poofs the departure
  // and a falling edge poofs the arrival (and hides/shows the sprite in between).
  private blinkHidden = false;
  // Charge dust trail: puffs are stamped by DISTANCE, not time, so a fast Charge
  // still leaves an evenly-spaced line of dust behind it (each stamp is a settling
  // puff left in place). This tracks where the last stamp landed; -1 = not charging.
  private lastChargeDustX = -1;
  private lastChargeDustY = -1;

  private movementFx(): PlayerMovementFX {
    if (!this.moveFx) this.moveFx = new PlayerMovementFX(this.scene);
    return this.moveFx;
  }

  /** Player subclasses call this from their state ingest: cache the movement fields
   *  and fire the one-shot ability burst when abilitySeq advances. */
  protected ingestMovementState(v: {
    airHeight: number;
    abilityCooldownFrac: number;
    abilityId: string;
    abilitySeq: number;
    blinkHidden: boolean;
  }): void {
    this.movementAirHeight = v.airHeight;
    this.movementCooldownFrac = v.abilityCooldownFrac;
    this.movementAbilityId = v.abilityId;

    // Blink is driven by its blinkHidden transitions, not abilitySeq: the departure
    // poof fires as the Mage vanishes (still at the origin), the arrival poof as it
    // reappears (now teleported), with a beat of absence between.
    if (v.blinkHidden !== this.blinkHidden) {
      this.movementFx().blinkPoof(this.sprite.x, this.sprite.y, v.blinkHidden ? "leave" : "arrive");
      this.blinkHidden = v.blinkHidden;
    }

    if (v.abilitySeq !== this.lastAbilitySeq) {
      // Skip the very first observation (no cast happened) and any idle bump. Blink
      // handles its own FX above, so the generic burst is only for the other three.
      if (this.lastAbilitySeq !== -1 && v.abilityId && v.abilityId !== "blink") {
        this.movementFx().burst(this.sprite.x, this.sprite.y, v.abilityId);
      }
      this.lastAbilitySeq = v.abilitySeq;
    }
  }

  /** Player subclasses call this at the END of their per-frame update (after
   *  positioning + HP bar + anim): lift the sprite for a Vault and update the
   *  shadow + cooldown bar. */
  private prevAirHeight = 0;

  protected renderMovementFX(): void {
    const h = this.movementAirHeight;
    // Absolute (not incremental) so it can't accumulate across frames — LocalPlayer
    // repositions the sprite every frame but only refreshes the HP bar on server
    // sync, so we lift the sprite (whose y was just reset by syncSpritePosition) and
    // leave the overhead HP bar where it is. syncSpritePosition already ran via
    // playAnim, so charSprite.y == sprite.y here when grounded.
    if (this.charSprite && h > 0) {
      this.charSprite.y = this.sprite.y - h;
    }

    // Vault landing: a low dust puff the frame the leap touches back down.
    if (this.prevAirHeight > 1 && h <= 1) {
      this.movementFx().dust(this.sprite.x, this.sprite.y, "land");
    }
    this.prevAirHeight = h;

    // Charge dust trail: drop a settling puff at the feet every CHARGE_DUST_STEP px
    // of travel, so the rush leaves an evenly-spaced line of dust behind it (each
    // puff stamped in place, not following the player). Distance-paced so a fast
    // Charge doesn't clump its whole wake at the start.
    if (this.movementAbilityId === "charge") {
      const first = this.lastChargeDustX < 0;
      const moved = Math.hypot(this.sprite.x - this.lastChargeDustX, this.sprite.y - this.lastChargeDustY);
      if (first || moved >= CHARGE_DUST_STEP) {
        this.movementFx().dust(this.sprite.x, this.sprite.y, "charge");
        this.lastChargeDustX = this.sprite.x;
        this.lastChargeDustY = this.sprite.y;
      }
    } else {
      this.lastChargeDustX = -1; // reset so the next Charge stamps from its first frame
      this.lastChargeDustY = -1;
    }

    // Blink absence: hide the whole player (body + weapon + HP bar) while gone.
    const hidden = this.blinkHidden;
    this.charSprite?.setVisible(!hidden);
    this.weaponVisual.setVisible?.(!hidden);
    this.hpBar.setVisible(!hidden);
    this.hpBarBg.setVisible(!hidden);

    this.movementFx().sync(this.sprite.x, this.sprite.y, h, this.movementCooldownFrac);
  }

  private downedShown = false;

  /** Ghost + blue-tint a downed player so a collapsed teammate reads at a glance.
   *  Idempotent — cheap to call every frame from the sync path. */
  setDowned(downed: boolean) {
    if (downed === this.downedShown) return;
    this.downedShown = downed;
    const alpha = downed ? 0.4 : 1;
    this.sprite.setAlpha(alpha);
    this.charSprite?.setAlpha(alpha);
    if (downed) this.charSprite?.setTint(0x6f8cff);
    else this.charSprite?.clearTint();
  }

  updateHpBar(hp: number) {
    if (!this.isHurt && this.lastHp !== undefined && hp < this.lastHp) {
      this.isHurt = true;
    }
    this.lastHp = hp;

    // Clamped to [0,1]: health is server-capped at maxHp, but a stale maxHp (or a
    // one-tick lag between a heal and a max-HP sync) must never draw a bar past full.
    const ratio = Math.min(1, Math.max(0, hp / this.maxHp));
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
    const ratio = this.lastHp !== undefined ? Math.min(1, Math.max(0, this.lastHp / this.maxHp)) : 1;
    this.repositionHpBar(ratio);
  }

  /** True once destroy() has run. Colyseus `onChange` callbacks outlive the view
   *  they were registered for — a local player joining destroys the RemotePlayer
   *  the observer room briefly created for the same session (playtest B2) — and
   *  driving a destroyed sprite throws INSIDE the sync callback, which takes the
   *  rest of that room's state handling down with it. Views check this. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }
  private destroyed = false;

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sprite.destroy();
    this.charSprite?.destroy();
    this.weaponVisual.destroy();
    this.hpBar.destroy();
    this.hpBarBg.destroy();
    this.moveFx?.destroy();
  }
}
