import { FLYING_CRUISE_HEIGHT, EnemyType } from "shared";
import { ClientEnemyDef } from "../types";
import { boss } from "./factory";

// The Wyverns fly: their sprite is a 4×2 sheet — row 0 (frames 0-3) flaps for
// normal cruising; row 1 (frames 4-7) is the dive. A swoop coils on frame 3 (the
// wind-up tell), then the dive frame is driven directly by the boss's airHeight —
// full height → frame 4, floor → frame 7 — so it plays 4→7 dropping and, because
// the frame is a pure function of height, auto-reverses 7→4 as it climbs back out.
function wyvernDef(id: EnemyType, name: string): ClientEnemyDef {
  const base = boss(id, name, { frameRate: 10 });
  const moveKey = `${id}-move`;
  return {
    ...base,
    airborne: true,
    resolve: (state) => {
      if (state.isDying) return base.resolve(state);
      const flipX = state.facing === "left";
      if (state.abilityId === "swoop") {
        // Coiled and about to dive: hold the last flap frame during the wind-up.
        if (state.telegraph) return { key: moveKey, flipX, frame: 3 };
        if (state.channeling) {
          const t = Math.min(1, Math.max(0, state.airHeight / FLYING_CRUISE_HEIGHT));
          return { key: moveKey, flipX, frame: 4 + Math.round(3 * (1 - t)) };
        }
      }
      return base.resolve(state); // normal flapping
    },
  };
}

export const wyvern = wyvernDef("wyvern", "Wyvern");
export const wyvernGreen = wyvernDef("wyvern-green", "Green Wyvern");
export const wyvernGrey = wyvernDef("wyvern-grey", "Grey Wyvern");
