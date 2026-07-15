import { frameRow } from "../sheetEnemy";
import { defineClips } from "../../entities/SpriteClips";
import { ClientEnemyDef } from "../types";
import { boss } from "./factory";

// The Turtle Dragon renders its walk row normally but swaps to the spin row
// (frames 10-13) while it channels its Shell Spin dash — the client learns this
// from the boss's abilityId ("shell-spin") passed to resolve as `action`.
// 16×1 @32: cols 0-3 idle, 4-9 walk, 10-13 spin, 14-15 damage.
function turtleDragonDef(): ClientEnemyDef {
  const base = boss("turtle-dragon", "Turtle Dragon", { frameWidth: 32, cols: 16, moveFrames: frameRow(16, 0, 4, 6) });
  const spinKey = "turtle-dragon-spin";
  return {
    ...base,
    defineAnimations: (scene) => {
      base.defineAnimations(scene);
      defineClips(scene, base.textureKey, {
        [spinKey]: { frames: frameRow(16, 0, 10, 4), frameRate: 16, repeat: -1 },
      });
    },
    // Both the dash and the stationary whirl render as the spin row.
    resolve: (state) =>
      !state.isDying && state.channeling && (state.abilityId === "shell-spin" || state.abilityId === "shell-whirl")
        ? { key: spinKey, flipX: false }
        : base.resolve(state),
  };
}

export const turtleDragon = turtleDragonDef();
