// The binding registry — the one source of truth for which physical controls
// drive which action, across BOTH input devices.
//
// Each action carries a keyboard binding (two interchangeable keys, Key 1 / Key 2,
// either 0 = unbound) AND a controller binding (one gamepad button index, or
// PAD_UNBOUND). Keyboard keys are globally unique across the whole table — binding
// a key that's already in use unbinds it wherever it was — and so are gamepad
// buttons, in their own namespace (a keycode and a button index never collide
// because they live in separate fields).
//
// Movement (up/down/left/right) has NO gamepad button: on a controller you move
// with the left stick, which is analog and not a rebindable button. Those rows
// show "L-Stick" in the controller column and their `pad` stays PAD_UNBOUND.
//
// KeyboardInputSource and GamepadInputSource both read their half from here; the
// rebind menu edits a draft of it; nothing else needs to know a keycode or button
// index. When we need to SHOW a control to the player (the "press F to take"
// prompt), promptKeyLabel() is the device-aware formatter.

import { inputMode } from "../input/inputMode";

export type BindableAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "attack"
  | "ability"
  | "prevSlot"
  | "nextSlot"
  | "menu"
  | "interact"
  // Reserved (shown but never rebindable — see RESERVED_ACTIONS).
  | "pause";

/** No gamepad button bound (movement, or an explicitly-cleared action). */
export const PAD_UNBOUND = -1;

/** One action's controls: `keys` = two interchangeable keyboard keys (0 = unbound);
 *  `pad` = a gamepad button index, or PAD_UNBOUND. */
export interface ActionBinding {
  keys: [number, number];
  pad: number;
}
export type KeyBindings = Record<BindableAction, ActionBinding>;

export const BINDING_SLOTS = 2;

/** Movement is the analog left stick — no bindable button. */
export const MOVEMENT_ACTIONS: ReadonlySet<BindableAction> = new Set([
  "up",
  "down",
  "left",
  "right",
]);

export function isMovementAction(action: BindableAction): boolean {
  return MOVEMENT_ACTIONS.has(action);
}

/** Reserved controls: shown in the rebind screen for reference but never editable.
 *  Pause is the ESC-equivalent (keyboard Esc, controller Start) — deliberately
 *  fixed so Esc can also cancel an in-progress capture without ambiguity. */
export const RESERVED_ACTIONS: ReadonlySet<BindableAction> = new Set(["pause"]);

export function isReservedAction(action: BindableAction): boolean {
  return RESERVED_ACTIONS.has(action);
}

/** The rebind screen renders this order, one editable row each. */
export const BINDABLE_ACTIONS: { action: BindableAction; label: string }[] = [
  { action: "up",       label: "Move Up" },
  { action: "down",     label: "Move Down" },
  { action: "left",     label: "Move Left" },
  { action: "right",    label: "Move Right" },
  { action: "attack",   label: "Attack" },
  { action: "ability",  label: "Movement Ability" },
  { action: "prevSlot", label: "Previous Weapon" },
  { action: "nextSlot", label: "Next Weapon" },
  { action: "menu",     label: "Inventory / Menu" },
  { action: "interact", label: "Interact / Open" },
];

/** Reserved rows, rendered greyed-out below the editable ones. */
export const RESERVED_ROWS: { action: BindableAction; label: string }[] = [
  { action: "pause", label: "Pause / Menu" },
];

/** Every binding row (editable + reserved) — the set that persistence and
 *  conflict checks must iterate so a reserved control's slot stays accounted for. */
export const ALL_BINDING_ROWS: { action: BindableAction; label: string }[] = [
  ...BINDABLE_ACTIONS,
  ...RESERVED_ROWS,
];

const K = Phaser.Input.Keyboard.KeyCodes;

// Standard W3C gamepad button indices (what an Xbox pad reports on macOS/Chrome).
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
} as const;

/** Ships as WASD + arrow-cluster secondaries for the keyboard, and the usual
 *  Xbox layout for the controller (A attack, B ability, LB/RB switch, Start menu,
 *  X interact). */
export const DEFAULT_BINDINGS: KeyBindings = {
  up:       { keys: [K.W, K.UP],                 pad: PAD_UNBOUND },
  down:     { keys: [K.S, K.DOWN],               pad: PAD_UNBOUND },
  left:     { keys: [K.A, K.LEFT],               pad: PAD_UNBOUND },
  right:    { keys: [K.D, K.RIGHT],              pad: PAD_UNBOUND },
  attack:   { keys: [K.SPACE, K.ENTER],          pad: PAD.A },
  ability:  { keys: [K.SHIFT, K.FORWARD_SLASH],  pad: PAD.B },
  prevSlot: { keys: [K.Q, K.OPEN_BRACKET],       pad: PAD.LB },
  nextSlot: { keys: [K.E, K.CLOSED_BRACKET],     pad: PAD.RB },
  menu:     { keys: [K.I, K.BACK_SLASH],         pad: PAD.VIEW },
  interact: { keys: [K.F, K.PERIOD],             pad: PAD.X },
  // Reserved: Esc / Start. Not editable — kept in sync with the GameScene handler.
  pause:    { keys: [K.ESC, 0],                  pad: PAD.MENU },
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
  [K.ESC]: "Esc",
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

// Controller button glyphs, by index. Short so they fit an in-world prompt pill.
const PAD_LABELS: Record<number, string> = {
  [PAD.A]: "Ⓐ",
  [PAD.B]: "Ⓑ",
  [PAD.X]: "Ⓧ",
  [PAD.Y]: "Ⓨ",
  [PAD.LB]: "LB",
  [PAD.RB]: "RB",
  [PAD.LT]: "LT",
  [PAD.RT]: "RT",
  [PAD.VIEW]: "View",
  [PAD.MENU]: "Menu",
  [PAD.LS]: "L3",
  [PAD.RS]: "R3",
  12: "D↑",
  13: "D↓",
  14: "D←",
  15: "D→",
};

/** Human-facing name for a gamepad button index. Unbound reads as an em-dash. */
export function padLabel(button: number): string {
  if (button < 0) return "—";
  return PAD_LABELS[button] ?? `B${button}`;
}

/** The control to SHOW for an action, in the device the player is currently
 *  using: a controller glyph when they're on the pad (or "L-Stick" for movement),
 *  otherwise the keyboard key. Prompts re-read this each frame, so it flips the
 *  instant the player switches devices. */
export function promptKeyLabel(action: BindableAction): string {
  if (inputMode() === "pad") {
    if (isMovementAction(action)) return "L-Stick";
    return padLabel(loadBindings()[action].pad);
  }
  const [k1, k2] = loadBindings()[action].keys;
  return keyLabel(k1 || k2);
}

// ── Persistence ────────────────────────────────────────────────────────────
const STORAGE_KEY = "game2.keybindings";
let cached: KeyBindings | null = null;

// Bumped on every save so a live input source can notice its bindings are stale
// and rebuild — that's what makes a rebind from the pause menu apply to the run in
// progress instead of only the next one.
let version = 0;
export function bindingsVersion(): number {
  return version;
}

function mergeDefaults(saved: Partial<Record<BindableAction, unknown>>): KeyBindings {
  const merged = cloneBindings(DEFAULT_BINDINGS);
  for (const { action } of BINDABLE_ACTIONS) {
    // Reserved actions are never read from storage — their defaults are law.
    if (isReservedAction(action)) continue;
    const entry = saved[action];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<ActionBinding>;
    if (Array.isArray(e.keys) && e.keys.length === 2) {
      merged[action].keys = [Number(e.keys[0]) || 0, Number(e.keys[1]) || 0];
    }
    if (typeof e.pad === "number" && !isMovementAction(action)) {
      merged[action].pad = Math.trunc(e.pad);
    }
  }
  // Reserved controls are exclusive: an older save (or a default change) could
  // leave an editable action sitting on a reserved key/button — strip it so the
  // reserved control keeps sole ownership.
  for (const { action } of RESERVED_ROWS) {
    const { keys, pad } = merged[action];
    for (const { action: other } of BINDABLE_ACTIONS) {
      for (let slot = 0; slot < BINDING_SLOTS; slot++) {
        if (merged[other].keys[slot] && keys.includes(merged[other].keys[slot])) {
          merged[other].keys[slot] = 0;
        }
      }
      if (pad >= 0 && merged[other].pad === pad) merged[other].pad = PAD_UNBOUND;
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
  for (const { action } of ALL_BINDING_ROWS) {
    out[action] = {
      keys: [bindings[action].keys[0], bindings[action].keys[1]],
      pad: bindings[action].pad,
    };
  }
  return out;
}
