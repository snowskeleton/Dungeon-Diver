import Phaser from "phaser";
import { Facing, RangedStyle, WEAPON_REGISTRY } from "shared";
import {
  AttackFXType,
  StripFXType,
  createAttackFXSprite,
  playAttackFX,
  syncAttackFX,
  WEAPON_ICON_DISPLAY_SIZE,
} from "./AttackFXSprites";
import { NovaFX } from "./NovaFX";
import { createBowSprite, playBowFX, syncBowFX } from "./RangedWeaponFX";
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
  /** Fire the one-shot attack visual. Called on the frame a swing starts. */
  playAttack(x: number, y: number, facing: Facing): void;
  destroy(): void;
}

/** Melee: a one-shot slash/stab strip, optionally with the weapon icon tracked
 *  along its keyframes. Either half may be absent — a weapon can have a strip
 *  with no icon or an icon with no strip. */
class MeleeSwingVisual implements WeaponVisual {
  private readonly fxSprite?: Phaser.GameObjects.Sprite;
  private readonly icon?: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    private readonly fxType: StripFXType | null,
    weaponIconTextureKey?: string,
  ) {
    if (fxType) this.fxSprite = createAttackFXSprite(scene, fxType);
    if (weaponIconTextureKey) {
      this.icon = scene.add.image(0, 0, weaponIconTextureKey);
      this.icon.setOrigin(0.5, 0.5);
      this.icon.setDepth(2.6);
      this.icon.setDisplaySize(WEAPON_ICON_DISPLAY_SIZE, WEAPON_ICON_DISPLAY_SIZE);
      this.icon.setVisible(false);
    }
  }

  sync(x: number, y: number): void {
    // Keep an in-flight swing anchored to the entity.
    if (this.fxSprite) syncAttackFX(this.fxSprite, x, y, this.icon);
  }

  playAttack(x: number, y: number, facing: Facing): void {
    if (!this.fxType || !this.fxSprite) return;
    playAttackFX(this.fxSprite, this.fxType, x, y, facing, this.icon);
  }

  destroy(): void {
    this.fxSprite?.destroy();
    this.icon?.destroy();
  }
}

/** Held ranged (bow/crossbow): a 2-frame draw sheet beside the player. */
class HeldBowVisual implements WeaponVisual {
  private readonly bowSprite: Phaser.GameObjects.Sprite;

  constructor(scene: Phaser.Scene, private readonly weaponId: string) {
    this.bowSprite = createBowSprite(scene, weaponId);
  }

  sync(x: number, y: number): void {
    syncBowFX(this.bowSprite, x, y);
  }

  playAttack(x: number, y: number, facing: Facing): void {
    playBowFX(this.bowSprite, this.weaponId, x, y, facing);
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

  destroy(): void {
    this.novaFx.destroy();
  }
}

/** Thrown (knife/star/boomerang): the flying projectile is the whole visual, so
 *  nothing stays in hand. A real object rather than a null field, so Entity's
 *  anim path never has to ask whether a visual exists. */
class NoVisual implements WeaponVisual {
  sync(): void {}
  playAttack(): void {}
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
    return new HeldBowVisual(scene, weaponIconTextureKey);
  }
  if (rangedStyle === "cast" && weaponIconTextureKey) {
    return new HeldStaffVisual(scene, weaponIconTextureKey, x, y, facing);
  }
  if (rangedStyle === "thrown") {
    return new NoVisual();
  }
  if (fxType === "nova") {
    // weaponIconTextureKey is the weapon id here; size the blast to its AoeSpec.
    const radius = WEAPON_REGISTRY[weaponIconTextureKey ?? ""]?.aoe?.radius ?? 76;
    return new NovaVisual(scene, radius);
  }
  return new MeleeSwingVisual(scene, fxType, weaponIconTextureKey);
}
