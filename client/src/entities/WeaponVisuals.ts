import Phaser from "phaser";
import { Facing, RangedStyle, resolveWeapon, ComboSwing } from "shared";
import {
  AttackFXType,
  StripFXType,
  createAttackFXSprite,
  playAttackFX,
  syncAttackFX,
  holdWeaponIconAtRest,
  poseWeaponIconWindup,
  WEAPON_ICON_DISPLAY_SIZE,
} from "./AttackFXSprites";
import { NovaFX } from "./NovaFX";
import { createBowSprite, playBowFX, syncBowFX, showHeldBow } from "./RangedWeaponFX";
import { createCastSprite, playCastFX, syncCastFX, showHeldStaff } from "./CastFX";

/**
 * How one weapon looks in a character's hands.
 *
 * This used to be five parallel optional fields on Entity (fxSprite+fxType,
 * weaponIconImage, bowSprite+rangedWeaponId, castSprite, novaFx) with three
 * methods branching over which combination happened to exist — a sum type
 * flattened into nullable fields, which is the shape the engineering note tells
 * us to avoid. It's now one field holding one of these, and Entity calls
 * `sync`/`playAttack` unconditionally.
 *
 * Each class wraps an existing FX helper module; none of that art code moved.
 */
export interface WeaponVisual {
  /** Follow the owner. Called every frame from the anim path. */
  sync(x: number, y: number, facing: Facing): void;
  /** Fire the one-shot attack visual. Called on the frame a swing starts. The
   *  optional combo swing selects which strip to draw and whether to mirror it;
   *  omitted (or unsupported) means the weapon's default first swing. */
  playAttack(x: number, y: number, facing: Facing, swing?: ComboSwing | null): void;
  /** Hold the wind-up pose while a deferred melee attack is charging (the weapon
   *  cocked back at the swing's first keyframe). No-op for weapons that don't
   *  charge. `swing` hints which swing is being wound up (hard vs combo). */
  showWindup(x: number, y: number, facing: Facing, swing?: ComboSwing | null): void;
  /** Show/hide every piece of this visual — used to make a Blinking player vanish
   *  during the teleport gap. No-op for visuals with nothing held (thrown / nova). */
  setVisible?(visible: boolean): void;
  /** Recolour the held art to a weapon-instance tint (a rolled modifier's colour —
   *  a Frost mod tints the blade cyan). `null` clears any tint. No-op for visuals
   *  with nothing held. The tint rides on the WeaponInstance, so it survives a swap:
   *  Entity re-applies it whenever it (re)builds this visual. */
  setTint?(tint: number | null): void;
  destroy(): void;
}

/** A weapon carried in hand: its icon rests in the player's right hand between
 *  uses, and a melee one additionally plays a slash/stab strip on attack (the
 *  icon sweeping through the arc's keyframes). Covers every hand-held weapon —
 *  swords, spears, and the strip-less thrown knives alike. Either half may be
 *  absent: a weapon can have a strip with no icon, or an icon with no strip (a
 *  thrown weapon, held but never swung). */
class HeldWeaponVisual implements WeaponVisual {
  // One strip sprite per FX type this weapon can swing — its base type plus any
  // combo variants (the finisher's wider strip). Created lazily and cached, since
  // a swing may be the first this weapon has drawn of that variant.
  private readonly fxSprites = new Map<StripFXType, Phaser.GameObjects.Sprite>();
  // The strip currently playing, so sync() re-anchors the right one.
  private activeSprite?: Phaser.GameObjects.Sprite;
  private readonly icon?: Phaser.GameObjects.Image;
  /** The weapon's natural hold tilt, from its config (see AttackFXSprites). */
  private readonly iconAngle: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly fxType: StripFXType | null,
    weaponIconTextureKey: string | undefined,
    x: number,
    y: number,
    facing: Facing,
  ) {
    // Pre-create the base strip (and, for a melee weapon, its combo variants) so
    // the first swing of any variant doesn't stutter building its sprite.
    if (fxType) {
      this.spriteFor(fxType);
      for (const s of resolveWeapon(weaponIconTextureKey ?? "")?.comboSwings ?? []) {
        this.spriteFor(s.fxType);
      }
    }
    this.iconAngle = resolveWeapon(weaponIconTextureKey ?? "")?.iconAngle ?? 0;
    if (weaponIconTextureKey) {
      this.icon = scene.add.image(0, 0, weaponIconTextureKey);
      this.icon.setOrigin(0.5, 0.5);
      this.icon.setDisplaySize(WEAPON_ICON_DISPLAY_SIZE, WEAPON_ICON_DISPLAY_SIZE);
      // Held in hand from the moment it's equipped, like the staff and bow.
      holdWeaponIconAtRest(this.icon, x, y, facing, this.iconAngle);
    }
  }

  private spriteFor(fx: StripFXType): Phaser.GameObjects.Sprite {
    let sprite = this.fxSprites.get(fx);
    if (!sprite) {
      sprite = createAttackFXSprite(this.scene, fx);
      this.fxSprites.set(fx, sprite);
    }
    return sprite;
  }

  sync(x: number, y: number, facing: Facing): void {
    // While a swing is playing, its keyframes drive the icon (and the strip is
    // visible); the rest of the time the weapon rests in the hand.
    if (this.activeSprite?.visible) {
      syncAttackFX(this.activeSprite, x, y, this.icon);
    } else if (this.icon) {
      holdWeaponIconAtRest(this.icon, x, y, facing, this.iconAngle);
    }
  }

  playAttack(x: number, y: number, facing: Facing, swing?: ComboSwing | null): void {
    const fx = swing?.fxType ?? this.fxType;
    if (!fx) return;
    const sprite = this.spriteFor(fx);
    this.activeSprite = sprite;
    playAttackFX(sprite, fx, x, y, facing, this.icon, this.iconAngle, swing?.mirrored ?? false);
  }

  showWindup(x: number, y: number, facing: Facing, swing?: ComboSwing | null): void {
    const fx = swing?.fxType ?? this.fxType;
    if (!this.icon || !fx) return;
    // No strip during the wind-up — just the icon cocked back at its first keyframe.
    if (this.activeSprite?.visible) this.activeSprite.setVisible(false);
    poseWeaponIconWindup(this.icon, fx, x, y, facing, this.iconAngle, swing?.mirrored ?? false);
  }

  setVisible(visible: boolean): void {
    this.icon?.setVisible(visible);
    // Hide any strip mid-swing too; on show, leave it hidden — sync() re-poses the
    // icon at rest next frame, and a 130ms Blink rarely overlaps a live swing.
    if (!visible) this.activeSprite?.setVisible(false);
  }

  setTint(tint: number | null): void {
    // Tint the resting icon AND every swing strip so the blade reads the same
    // colour cocked back or mid-arc.
    if (tint === null) {
      this.icon?.clearTint();
      for (const s of this.fxSprites.values()) s.clearTint();
    } else {
      this.icon?.setTint(tint);
      for (const s of this.fxSprites.values()) s.setTint(tint);
    }
  }

  destroy(): void {
    for (const s of this.fxSprites.values()) s.destroy();
    this.icon?.destroy();
  }
}

/** Held ranged (bow/crossbow): a 2-frame draw sheet beside the player. */
class HeldBowVisual implements WeaponVisual {
  private readonly bowSprite: Phaser.GameObjects.Sprite;

  constructor(
    scene: Phaser.Scene,
    private readonly weaponId: string,
    x: number,
    y: number,
    facing: Facing,
  ) {
    // The crossbow is one-handed: hold it in the right hand, not centred like a
    // two-handed bow draw.
    const handHeld = resolveWeapon(weaponId)?.category === "crossbow";
    this.bowSprite = createBowSprite(scene, weaponId, handHeld);
    // Held in hand from the moment it's equipped (like the staff), so it doesn't
    // blink out between shots on the slower bows.
    showHeldBow(this.bowSprite, x, y, facing);
  }

  sync(x: number, y: number, facing: Facing): void {
    syncBowFX(this.bowSprite, x, y, facing);
  }

  playAttack(x: number, y: number, facing: Facing): void {
    playBowFX(this.bowSprite, this.weaponId, x, y, facing);
  }

  showWindup(): void {} // ranged weapons don't charge

  setVisible(visible: boolean): void {
    this.bowSprite.setVisible(visible);
  }

  setTint(tint: number | null): void {
    if (tint === null) this.bowSprite.clearTint();
    else this.bowSprite.setTint(tint);
  }

  destroy(): void {
    this.bowSprite.destroy();
  }
}

/** Staff (rangedStyle "cast"): the icon stays in hand and pulses on each cast. */
class HeldStaffVisual implements WeaponVisual {
  private readonly castSprite: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, weaponId: string, x: number, y: number, facing: Facing) {
    this.castSprite = createCastSprite(scene, weaponId);
    showHeldStaff(this.castSprite, x, y, facing);
  }

  sync(x: number, y: number, facing: Facing): void {
    syncCastFX(this.castSprite, x, y, facing);
  }

  playAttack(x: number, y: number, facing: Facing): void {
    playCastFX(this.castSprite, x, y, facing);
  }

  showWindup(): void {} // staves cast, they don't charge a melee swing

  setVisible(visible: boolean): void {
    this.castSprite.setVisible(visible);
  }

  setTint(tint: number | null): void {
    if (tint === null) this.castSprite.clearTint();
    else this.castSprite.setTint(tint);
  }

  destroy(): void {
    this.castSprite.destroy();
  }
}

/** AOE staff: an expanding blast is the whole FX — nothing is held or swung. */
class NovaVisual implements WeaponVisual {
  private readonly novaFx: NovaFX;

  constructor(scene: Phaser.Scene, radius: number) {
    this.novaFx = new NovaFX(scene, radius);
  }

  sync(): void {
    // The blast is anchored where it was cast, not to the caster.
  }

  playAttack(x: number, y: number): void {
    this.novaFx.play(x, y);
  }

  showWindup(): void {}

  destroy(): void {
    this.novaFx.destroy();
  }
}

/** No weapon at all (an enemy driving its own sprite). A real object rather than
 *  a null field, so Entity's anim path never has to ask whether a visual exists. */
class NoVisual implements WeaponVisual {
  sync(): void {}
  playAttack(): void {}
  showWindup(): void {}
  destroy(): void {}
}

/** An entity with no weapon at all (an enemy driving its own sprite). Lets
 *  Entity hold a real WeaponVisual from construction, so nothing downstream
 *  needs a null check. */
export function createNoWeaponVisual(): WeaponVisual {
  return new NoVisual();
}

/**
 * Build the visual for a weapon. One exhaustive decision, made once, instead of
 * the same branching repeated in configure/swap/sync/playAttack.
 */
export function createWeaponVisual(
  scene: Phaser.Scene,
  fxType: AttackFXType | null,
  weaponIconTextureKey: string | undefined,
  rangedStyle: RangedStyle | undefined,
  x: number,
  y: number,
  facing: Facing,
): WeaponVisual {
  if (rangedStyle === "held" && weaponIconTextureKey) {
    return new HeldBowVisual(scene, weaponIconTextureKey, x, y, facing);
  }
  if (rangedStyle === "cast" && weaponIconTextureKey) {
    return new HeldStaffVisual(scene, weaponIconTextureKey, x, y, facing);
  }
  if (rangedStyle === "thrown") {
    // Nothing in hand: the flying projectile is the whole visual. (A held icon
    // just sitting in the hand between throws looked odd — hidden for now until
    // there's a better throw pose.)
    return new NoVisual();
  }
  if (fxType === "nova") {
    // weaponIconTextureKey is the weapon id here; size the blast to its AoeSpec.
    const radius = resolveWeapon(weaponIconTextureKey ?? "")?.aoe?.radius ?? 76;
    return new NovaVisual(scene, radius);
  }
  return new HeldWeaponVisual(scene, fxType, weaponIconTextureKey, x, y, facing);
}
