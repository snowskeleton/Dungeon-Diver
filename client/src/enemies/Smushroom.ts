import { makeSheetEnemyDef } from "./sheetEnemy";

// The Smushroom releases a lingering damage cloud (its only attack). cloudAura draws
// a PLACEHOLDER gas circle while it channels; radius matches the server hitbox
// (CLOUD_RADIUS in the server's Smushroom) — swap for real cloud art later.
export const smushroom = {
  ...makeSheetEnemyDef("smushroom", { name: "Smushroom" }),
  cloudAura: { radius: 60 },
};
