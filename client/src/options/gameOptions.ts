import { FieldSpec } from "../ui/FieldPanel";

// Mostly client-only presentation settings — same pattern as the debug menu: add
// a property + a field entry and it renders. The EXCEPTIONS are comboWindowMs and
// chargeHoldMs: they govern server-authoritative melee timing, so LocalPlayer sends
// them to the room (a "meleeTuning" message) on join. They live here because they
// are player preferences the player tunes, not map/balance constants.
import { DEFAULT_COMBO_WINDOW_MS, DEFAULT_CHARGE_HOLD_MS } from "shared";

export interface GameOptions {
  showHitboxes: boolean;
  showControlsHint: boolean;
  showMinimap: boolean;
  /** Extra grace (ms) for continuing a melee combo beyond the weapon's cooldown.
   *  Sent to the server; see the note above. */
  comboWindowMs: number;
  /** How long (ms) a melee attack must be held before releasing a hard (charged)
   *  swing instead of a regular one. Sent to the server; see the note above. */
  chargeHoldMs: number;
}

export const DEFAULT_OPTIONS: GameOptions = {
  showHitboxes: false,
  showControlsHint: true,
  showMinimap: true,
  comboWindowMs: DEFAULT_COMBO_WINDOW_MS,
  chargeHoldMs: DEFAULT_CHARGE_HOLD_MS,
};

export const OPTION_FIELDS: FieldSpec<GameOptions>[] = [
  {
    kind: "toggle", key: "showHitboxes", label: "Hitbox overlay",
    help: "Start with the H overlay already on",
  },
  { kind: "toggle", key: "showControlsHint", label: "Controls hint" },
  {
    kind: "toggle", key: "showMinimap", label: "Minimap",
    help: "Show the dungeon minimap in the top-right corner",
  },
  {
    kind: "number", key: "comboWindowMs", label: "Combo window (ms)",
    help: "Extra time after a swing to keep a melee combo going (first → reverse → finisher). Shorter is snappier.",
    min: 0, max: 2000, step: 50,
  },
  {
    kind: "number", key: "chargeHoldMs", label: "Hard-swing hold (ms)",
    help: "How long to hold the attack before releasing a heavy charged swing. Below this, a release is a normal swing.",
    min: 50, max: 3000, step: 50,
  },
];

const STORAGE_KEY = "game2.options";

let cached: GameOptions | null = null;

export function loadOptions(): GameOptions {
  if (cached) return cached;
  let loaded: GameOptions = { ...DEFAULT_OPTIONS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) loaded = { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    // Corrupt or unavailable storage — fall back to defaults.
  }
  cached = loaded;
  return loaded;
}

export function saveOptions(opts: GameOptions) {
  cached = opts;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // Non-fatal: options just won't persist across reloads.
  }
}
