// The keyboard binding registry — the one source of truth for which physical
// keys drive which action for the (single) keyboard player.
//
// Each action carries two interchangeable slots, Key 1 and Key 2; either being
// down fires the action, and either may be left unbound (0). A physical key does
// exactly one thing, so bindings are globally unique across the whole table —
// binding a key that's already in use unbinds it wherever it was.
//
// A second couch player used to live on the arrow cluster; that seat is gone
// until controller support brings it back (index 0 is now the only keyboard
// seat). The arrows survive as the default Key 2 for movement etc., so a lone
// player who reaches for them still moves.
//
// KeyboardInputSource reads its keys from here; the rebind menu edits a draft of
// it; nothing else needs to know a keycode. When we need to SHOW a key to the
// player (the "press F to open" chest prompt), keyLabel() is the formatter.

export type BindableAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "attack"
  | "prevSlot"
  | "nextSlot"
  | "menu"
  | "interact";

/** The two interchangeable keys for one action, `[key1, key2]`; 0 = unbound. */
export type ActionBinding = [number, number];
export type KeyBindings = Record<BindableAction, ActionBinding>;

export const BINDING_SLOTS = 2;

/** The rebind screen renders this order, one row each. */
export const BINDABLE_ACTIONS: { action: BindableAction; label: string }[] = [
  { action: "up",       label: "Move Up" },
  { action: "down",     label: "Move Down" },
  { action: "left",     label: "Move Left" },
  { action: "right",    label: "Move Right" },
  { action: "attack",   label: "Attack" },
  { action: "prevSlot", label: "Previous Weapon" },
  { action: "nextSlot", label: "Next Weapon" },
  { action: "menu",     label: "Inventory / Menu" },
  { action: "interact", label: "Interact / Open" },
];

const K = Phaser.Input.Keyboard.KeyCodes;

/** Ships as WASD + a set of secondary keys (the old arrow-cluster scheme). */
export const DEFAULT_BINDINGS: KeyBindings = {
  up:       [K.W, K.UP],
  down:     [K.S, K.DOWN],
  left:     [K.A, K.LEFT],
  right:    [K.D, K.RIGHT],
  attack:   [K.SPACE, K.ENTER],
  prevSlot: [K.Q, K.OPEN_BRACKET],
  nextSlot: [K.E, K.CLOSED_BRACKET],
  menu:     [K.I, K.BACK_SLASH],
  interact: [K.F, K.PERIOD],
};

// ── Display names ──────────────────────────────────────────────────────────
// Phaser.Input.Keyboard.KeyCodes is name→code; invert it once for code→name,
// then override the ones whose raw name reads badly ("OPEN_BRACKET", "SPACE").
const CODE_TO_NAME: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (const [name, code] of Object.entries(K)) {
    if (typeof code === "number" && map[code] === undefined) map[code] = name;
  }
  return map;
})();

const PRETTY: Record<number, string> = {
  [K.UP]: "↑",
  [K.DOWN]: "↓",
  [K.LEFT]: "←",
  [K.RIGHT]: "→",
  [K.SPACE]: "Space",
  [K.ENTER]: "Enter",
  [K.SHIFT]: "Shift",
  [K.CTRL]: "Ctrl",
  [K.ALT]: "Alt",
  [K.TAB]: "Tab",
  [K.BACKSPACE]: "Backspace",
  [K.OPEN_BRACKET]: "[",
  [K.CLOSED_BRACKET]: "]",
  [K.BACK_SLASH]: "\\",
  [K.FORWARD_SLASH]: "/",
  [K.PERIOD]: ".",
  [K.COMMA]: ",",
  [K.SEMICOLON]: ";",
  [K.QUOTES]: "'",
  [K.MINUS]: "-",
  [K.PLUS]: "=",
  [K.BACKTICK]: "`",
};

/** Human-facing name for a keycode — for both the rebind cells and any in-world
 *  "press X" prompt. 0/unbound reads as an em-dash. */
export function keyLabel(code: number): string {
  if (!code) return "—";
  if (PRETTY[code]) return PRETTY[code];
  const raw = CODE_TO_NAME[code];
  if (!raw) return `#${code}`;
  // Single letters/digits come through as their own name already.
  return raw.length === 1 ? raw : raw.charAt(0) + raw.slice(1).toLowerCase();
}

/** The first bound key for an action, formatted — for an in-world "press X"
 *  prompt, which wants one key, not both. Falls back to Key 2 if Key 1 is
 *  unbound, and to an em-dash if neither is. */
export function promptKeyLabel(action: BindableAction): string {
  const [k1, k2] = loadBindings()[action];
  return keyLabel(k1 || k2);
}

// ── Persistence ────────────────────────────────────────────────────────────
const STORAGE_KEY = "game2.keybindings";
let cached: KeyBindings | null = null;

// Bumped on every save so a live KeyboardInputSource can notice its keys are
// stale and rebuild — that's what makes a rebind from the pause menu apply to
// the run in progress instead of only the next one.
let version = 0;
export function bindingsVersion(): number {
  return version;
}

function mergeDefaults(saved: Partial<Record<BindableAction, ActionBinding>>): KeyBindings {
  const merged = cloneBindings(DEFAULT_BINDINGS);
  for (const { action } of BINDABLE_ACTIONS) {
    const pair = saved[action];
    if (Array.isArray(pair) && pair.length === 2) {
      merged[action] = [Number(pair[0]) || 0, Number(pair[1]) || 0];
    }
  }
  return merged;
}

export function loadBindings(): KeyBindings {
  if (cached) return cached;
  let loaded = cloneBindings(DEFAULT_BINDINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) loaded = mergeDefaults(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage — fall back to defaults.
  }
  cached = loaded;
  return loaded;
}

export function saveBindings(bindings: KeyBindings) {
  cached = cloneBindings(bindings);
  version++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Non-fatal: bindings just won't persist across reloads.
  }
}

export function cloneBindings(bindings: KeyBindings): KeyBindings {
  const out = {} as KeyBindings;
  for (const { action } of BINDABLE_ACTIONS) {
    out[action] = [bindings[action][0], bindings[action][1]];
  }
  return out;
}
