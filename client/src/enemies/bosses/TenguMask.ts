import { makeSheetEnemyDef } from "../sheetEnemy";
import { frameRow, frameAt, ENEMY_SPRITE_GEOMETRY } from "../spriteGeometry";
import { defineClips } from "../../entities/SpriteClips";
import { ClientEnemyDef } from "../types";
import { boss } from "./factory";

// The Tengu Mask drives a distinct sheet row per ability (the client learns which
// from the boss's abilityId): row 1's orb/lightning cast for Storm Nova, row 2's
// dissolve-and-duplicate for Mirror Split, and the row-3 stoneface held through
// the whole Stone Crash (wind-up, flight, and landing lag). Row 0 idle otherwise.
// 18×4 @32: row 0 idle/looking, rows 1-2 spellcasting, row 3 stoneface.
function tenguMaskDef(): ClientEnemyDef {
  const { cols } = ENEMY_SPRITE_GEOMETRY["tengu-mask"];
  const base = boss("tengu-mask", "Tengu", { frameRate: 6 });
  const novaKey = "tengu-nova";
  const splitKey = "tengu-split";
  const stoneFrame = frameAt(cols, 3, 0); // row-3 stoneface (single frame)
  return {
    ...base,
    airborne: true, // so the Stone Crash draws a ground shadow while it's aloft
    defineAnimations: (scene) => {
      base.defineAnimations(scene);
      defineClips(scene, base.textureKey, {
        // Play each cast row once so its climax (the nova's white burst, the split's
        // copies) lands late in the wind-up rather than looping.
        [novaKey]: { frames: frameRow(cols, 1, 0, 18), frameRate: 16, repeat: 0 },
        [splitKey]: { frames: frameRow(cols, 2, 0, 13), frameRate: 16, repeat: 0 },
      });
    },
    resolve: (state) => {
      if (state.isDying) return base.resolve(state);
      const flipX = state.facing === "left";
      const casting = state.telegraph || state.channeling;
      if (state.abilityId === "storm-nova" && casting) return { key: novaKey, flipX };
      if (state.abilityId === "mirror-split" && casting) return { key: splitKey, flipX };
      // Stone the whole crash — the abilityId stays set through recovery, so it
      // reads as stone right up to the punish window.
      if (state.abilityId === "stone-drop") return { key: novaKey, flipX, frame: stoneFrame };
      return base.resolve(state); // idle / looking
    },
  };
}

export const tenguMask = tenguMaskDef();

// The Tengu's Mirror Split copies: the same sheet's idle row (row 0), rendered at
// half the boss size — a "smaller version of himself". Summon-only.
export const tenguShade = makeSheetEnemyDef("tengu-shade", {
  name: "Tengu Shade",
  frameRate: 6,
});
