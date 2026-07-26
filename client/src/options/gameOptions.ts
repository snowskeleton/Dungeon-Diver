import { FieldSpec } from "../ui/FieldPanel";

// Mostly client-only presentation settings — same pattern as the debug menu: add
// a property + a field entry and it renders. The ONE exception is comboWindowMs:
// it governs server-authoritative melee combo timing, so LocalPlayer sends it to
// the room (a "comboWindow" message) on join. It lives here because it is a player
// preference the player tunes, not a map/balance constant.
import { DEFAULT_COMBO_WINDOW_MS } from "shared";

export interface GameOptions {
  showHitboxes: boolean;
  showControlsHint: boolean;
  showMinimap: boolean;
  /** Extra grace (ms) for continuing a melee combo beyond the weapon's cooldown.
   *  Sent to the server; see the note above. */
  comboWindowMs: number;
}

export const DEFAULT_OPTIONS: GameOptions = {
  showHitboxes: false,
  showControlsHint: true,
  showMinimap: true,
  comboWindowMs: DEFAULT_COMBO_WINDOW_MS,
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
