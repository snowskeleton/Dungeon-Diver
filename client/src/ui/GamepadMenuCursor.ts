/**
 * Controller navigation for the DOM menus — one singleton that lets any gamepad
 * drive every full-screen overlay without a line of per-panel code.
 *
 * It works because every menu is built from the shared `menuDom` vocabulary
 * (`.m-btn`, `.m-row.clickable`, `.m-tile`, `.m-card`, `.m-chip`, inputs). This
 * cursor scans whichever `.m-overlay` is on top for those focusables, paints a
 * `.gp-focus` ring on one of them, and turns the pad into keyboard-equivalent
 * intent: D-pad / left-stick move the ring, A activates (a real `click()`), B
 * sends Escape (the same key every panel's `onEscape` already listens for).
 *
 * It runs its own requestAnimationFrame loop rather than riding a Phaser scene
 * tick, because menus live in the DOM across scene boundaries (and before any
 * game scene exists). It reads `navigator.getGamepads()` directly for the same
 * reason — no Phaser plugin dependency. When no overlay is open it does nothing.
 *
 * Text fields can be focused but not typed into: a controller has no keys, so
 * entering a room code or a name still needs a physical keyboard. That is the
 * one deliberate gap.
 */

// A focusable is anything a mouse could click inside a panel.
const FOCUSABLE_SELECTOR = [
  ".m-btn:not(:disabled)",
  ".m-row.clickable",
  ".m-tile",
  ".m-card",
  ".m-chip",
  // Rebind cells (Controls screen): each is a clickable button that starts a
  // capture or clears a slot, so a controller can drive the rebind screen too.
  ".kb-key:not(:disabled)",
  ".kb-clear:not(:disabled)",
  "input:not([type=checkbox]):not(:disabled)",
  "input[type=checkbox]:not(:disabled)",
  "select:not(:disabled)",
].join(",");

const AXIS_THRESHOLD = 0.5;
const REPEAT_DELAY_MS = 400; // hold-to-repeat: first repeat after this…
const REPEAT_RATE_MS = 140; // …then one step every this long

type Dir = "up" | "down" | "left" | "right";

// While the rebind menu is capturing a controller button, the cursor must not
// also treat that press as "activate/back" — it goes fully inert until released.
let captureLock = false;
export function setGamepadCaptureLock(locked: boolean) {
  captureLock = locked;
}
/** True while a rebind cell is swallowing the next controller press — callers that
 *  poll the pad directly (e.g. the in-game Pause button) must stand down so the
 *  press being bound isn't also consumed as a game action. */
export function isGamepadCaptureLocked(): boolean {
  return captureLock;
}

// Standard W3C gamepad mapping (what Xbox pads report on macOS/Chrome):
// 0 = A, 1 = B, 12/13/14/15 = D-pad up/down/left/right.
const BTN_A = 0;
const BTN_B = 1;
const DPAD: Record<Dir, number> = { up: 12, down: 13, left: 14, right: 15 };

export class GamepadMenuCursor {
  private raf = 0;
  private focused: HTMLElement | null = null;
  // Per-direction next-allowed-fire timestamp; 0 means "released, fire on press".
  private nextFire: Record<Dir, number> = { up: 0, down: 0, left: 0, right: 0 };
  private held: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
  private aWasDown = false;
  private bWasDown = false;

  start() {
    if (this.raf) return;
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearRing();
  }

  private tick() {
    if (captureLock) return; // a rebind cell is swallowing the next button press
    const overlay = this.topOverlay();
    if (!overlay) {
      this.clearRing();
      return;
    }
    const pad = this.firstPad();
    if (!pad) return;

    const items = this.focusables(overlay);
    if (items.length === 0) {
      this.clearRing();
      return;
    }

    // Keep the ring valid across re-renders: if the focused node is gone (or we
    // never had one), land on the first item.
    let index = this.focused ? items.indexOf(this.focused) : -1;
    if (index === -1) {
      index = 0;
      this.setRing(items[0]);
    }

    const now = performance.now();
    const dy = this.axis(pad, 1);
    const dx = this.axis(pad, 0);

    const down = this.dirActive(pad, "down", dy > AXIS_THRESHOLD, now);
    const up = this.dirActive(pad, "up", dy < -AXIS_THRESHOLD, now);
    const right = this.dirActive(pad, "right", dx > AXIS_THRESHOLD, now);
    const left = this.dirActive(pad, "left", dx < -AXIS_THRESHOLD, now);

    const step = (down ? 1 : 0) - (up ? 1 : 0) + (right ? 1 : 0) - (left ? 1 : 0);
    if (step !== 0) {
      const next = (index + step + items.length) % items.length;
      this.setRing(items[next]);
    }

    const aDown = pad.buttons[BTN_A]?.pressed ?? false;
    if (aDown && !this.aWasDown) this.activate();
    this.aWasDown = aDown;

    const bDown = pad.buttons[BTN_B]?.pressed ?? false;
    if (bDown && !this.bWasDown) this.escape();
    this.bWasDown = bDown;
  }

  /** True on the frame a direction should step: fires on press, then repeats
   *  while held after an initial delay. Combines D-pad button and stick axis. */
  private dirActive(pad: Gamepad, dir: Dir, axisPressed: boolean, now: number): boolean {
    const pressed = axisPressed || (pad.buttons[DPAD[dir]]?.pressed ?? false);
    if (!pressed) {
      this.held[dir] = false;
      this.nextFire[dir] = 0;
      return false;
    }
    if (!this.held[dir]) {
      this.held[dir] = true;
      this.nextFire[dir] = now + REPEAT_DELAY_MS;
      return true; // initial press
    }
    if (now >= this.nextFire[dir]) {
      this.nextFire[dir] = now + REPEAT_RATE_MS;
      return true; // repeat
    }
    return false;
  }

  private axis(pad: Gamepad, i: number): number {
    return pad.axes[i] ?? 0;
  }

  private firstPad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) if (pad) return pad;
    return null;
  }

  /** The overlay the player is looking at: the last `.m-overlay` in the DOM,
   *  which is the most-recently-opened (panels stack by append order). */
  private topOverlay(): HTMLElement | null {
    const overlays = document.querySelectorAll<HTMLElement>(".m-overlay");
    return overlays.length ? overlays[overlays.length - 1] : null;
  }

  private focusables(overlay: HTMLElement): HTMLElement[] {
    return Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null, // visible only
    );
  }

  private setRing(el: HTMLElement) {
    if (this.focused === el) return;
    this.clearRing();
    this.focused = el;
    el.classList.add("gp-focus");
    el.scrollIntoView({ block: "nearest" });
  }

  private clearRing() {
    this.focused?.classList.remove("gp-focus");
    this.focused = null;
  }

  private activate() {
    const el = this.focused;
    if (!el) return;
    // Text inputs need real focus so a physical keyboard can finish the job;
    // everything else is driven by a click, exactly as the mouse path is.
    if (el instanceof HTMLInputElement && el.type !== "checkbox") {
      el.focus();
      return;
    }
    el.click();
  }

  private escape() {
    // Every panel's onEscape listens for the Escape key on the window (capture);
    // synthesizing it reuses that one path instead of hunting for a cancel button.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  }
}

/** The one cursor for the whole app. */
export const gamepadMenuCursor = new GamepadMenuCursor();
