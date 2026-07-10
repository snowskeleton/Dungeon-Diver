import { FieldSpec } from "../ui/FieldPanel";

// Client-only presentation settings — nothing here reaches the server. Same
// pattern as the debug menu: add a property + a field entry and it renders.

export interface GameOptions {
  cameraZoom: number;
  showHitboxes: boolean;
  showControlsHint: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = {
  cameraZoom: 2,
  showHitboxes: false,
  showControlsHint: true,
};

export const OPTION_FIELDS: FieldSpec<GameOptions>[] = [
  {
    kind: "number", key: "cameraZoom", label: "Camera zoom", min: 1, max: 4, step: 0.5,
    help: "The room-locked camera's zoom factor",
  },
  {
    kind: "toggle", key: "showHitboxes", label: "Hitbox overlay",
    help: "Start with the H overlay already on",
  },
  { kind: "toggle", key: "showControlsHint", label: "Controls hint" },
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
