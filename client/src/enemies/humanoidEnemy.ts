import { EnemyType, HumanoidSkin, Facing, WeaponId } from "shared";
import {
  preloadHumanoid,
  defineHumanoidAnimations,
  humanoidAnimKey,
} from "../entities/HumanoidSprites";
import { ENEMY_SPRITE_GEOMETRY, frameAt } from "./spriteGeometry";
import { ClientEnemyDef } from "./types";

// Humanoid enemies render from the 15×4 player sheets (HumanoidSprites), not the
// simple enemy factories — the skeleton and skeleton-mage. The body plays walk /
// attack from the same clips a player uses; the held weapon (see heldWeapon) draws
// on top. This is the proof the humanoid + weapon render path generalises past
// players, which is the whole point of doing the skeletons.

// An id that is BOTH a humanoid sheet and an enemy type — the only skins that are
// enemies. Keeps the sheet-key and the geometry-key provably the same string.
type HumanoidEnemyId = HumanoidSkin & EnemyType;

const COLS = 15;
const ATTACK_START_COL = 8; // cols 8–11 are the attack row; col 8 is the cocked pose.

export function makeHumanoidEnemyDef(
  id: HumanoidEnemyId,
  name: string,
  heldWeapon: WeaponId,
): ClientEnemyDef {
  const geo = ENEMY_SPRITE_GEOMETRY[id];
  const attackKey = (f: Facing) => humanoidAnimKey(id, "attack", f);
  return {
    name,
    textureKey: id,
    displayW: geo.displayW,
    displayH: geo.displayH,
    heldWeapon: { weaponId: heldWeapon },
    preload: (scene) => preloadHumanoid(scene, id),
    defineAnimations: (scene) => defineHumanoidAnimations(scene, id),
    // The body's own telegraph: hold the cocked-back first attack frame during the
    // wind-up, then play the swing on the strike (channel). Otherwise walk. The
    // universal death flourish handles the dying read, so no death clip is needed.
    resolve: ({ isDying, facing, telegraph, channeling }) => {
      if (!isDying && telegraph) {
        return { key: attackKey(facing), flipX: false, frame: frameAt(COLS, ROW[facing], ATTACK_START_COL) };
      }
      if (!isDying && channeling) {
        return { key: attackKey(facing), flipX: false };
      }
      return { key: humanoidAnimKey(id, "walk", facing), flipX: false };
    },
  };
}

const ROW: Record<Facing, number> = { up: 0, right: 1, down: 2, left: 3 };
