// Which device the local player touched most recently — the one thing every
// on-screen control hint keys off of, so the game shows "Ⓧ open" on a controller
// and "F open" on a keyboard without either prompt knowing the other exists.
//
// It is a tiny global rather than game state because it is a pure PRESENTATION
// concern (nothing authoritative depends on it) and it spans scenes and menus,
// which have no shared object to hang it on. Input sources call noteInputActivity
// as they read; consumers read inputMode() and can watch inputModeVersion() to
// rebuild only when it actually flips.

export type InputMode = "kbd" | "pad";

let mode: InputMode = "kbd";
let version = 0;

export function inputMode(): InputMode {
  return mode;
}

/** Bumped each time the mode flips, so a cached HUD can tell it needs rebuilding. */
export function inputModeVersion(): number {
  return version;
}

/** Record that a device was just used. Cheap to call every frame — it only does
 *  work on an actual change. */
export function noteInputActivity(used: InputMode): void {
  if (used === mode) return;
  mode = used;
  version++;
}
