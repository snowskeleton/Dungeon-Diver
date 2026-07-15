import { frameRow } from "../sheetEnemy";
import { boss, BOSS_SIZE } from "./factory";

// Bosses that still only animate their locomotion clip (no ability-driven rows
// yet). Their sheet layouts are noted per entry. Mirrors the plain-boss classes
// in entities/bosses/.

// 8×4 @32: row 0 idle (4), row 1 gallop (4), row 2 club, row 3 lance.
export const centaurKnight = boss("centaur-knight", "Centaur Knight", {
  frameWidth: 32, cols: 8, moveFrames: frameRow(8, 1, 0, 4),
});

// 8×4 @32: row 0 idle (6), row 1 walk (8), row 2 hit/throw, row 3 roll.
export const bigBeast = boss("big-beast", "Big Beast", {
  frameWidth: 32, cols: 8, moveFrames: frameRow(8, 1, 0, 8),
});

// 8×6 @40: row 0 idle (4), row 1 walk (8), then breath/crouch/flap/stomp.
export const batwingButtstomper = boss("batwing-buttstomper", "Batwing Buttstomper", {
  frameWidth: 40, cols: 8, moveFrames: frameRow(8, 1, 0, 8), displaySize: BOSS_SIZE + 16,
});
