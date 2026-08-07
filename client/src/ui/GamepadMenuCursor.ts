/**
 * Controller navigation for the DOM menus — one singleton that lets any gamepad
 * drive every full-screen overlay without a line of per-panel code.
 *
 * It works because every menu is built from the shared `menuDom` vocabulary
 * (`.m-btn`, `.m-row.clickable`, `.m-tile`, `.m-card`, `.m-chip`, inputs). This
 * cursor scans whichever `.m-overlay` is on top for those focusables, paints a
 * `.gp-focus` ring on one of them, and turns the pad into keyboard-equivalent
 * intent: D-pad / left-stick move the ring, the Select button activates (a real
 * `click()`), the bound Back button sends Escape (the same key every panel's
 * `onEscape` already listens for). Select is the reserved menu-confirm control (A,
 * un-rebindable) and Back follows the player's `back` keybinding, so a Back rebind
 * flows through here too — B is Back by default, everywhere. Select stays A no
 * matter how the in-game Attack is rebound.
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

import { loadBindings } from "../options/keybindings";

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
// 12/13/14/15 = D-pad up/down/left/right. Select (activate) and Back (escape)
// are NOT hardcoded — they follow the player's `attack` / `back` keybindings so a
// controller rebind applies to the menus too.
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
    const overlay = this.topOverlay();
    const pad = this.firstPad();

    // While a rebind cell is swallowing the next controller input we take NO menu
    // action — but we must keep sampling the pad so the press being bound isn't
    // also seen as navigation the instant the lock lifts. The lock releases the
    // frame the button is captured, often while it's still physically held; if we
    // skipped sampling, `dirActive` would then read that held button as a fresh
    // press and move the ring. Syncing held-state (silently) makes it read as
    // "already held", so nothing fires until the player releases and presses again.
    if (captureLock) {
      if (pad) this.syncHeldSilently(pad);
      return;
    }

    if (!overlay) {
      this.clearRing();
      return;
    }
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

    // Navigate by on-screen geometry, not DOM order: each direction steps to the
    // nearest focusable that actually lies that way. This is what makes "down" go
    // down and "right" go right even when a panel mixes rows and columns (the
    // rebind grid). A pure-vertical or pure-horizontal menu still walks in order
    // because there's only ever one candidate on the pressed axis.
    const dir: Dir | null = down ? "down" : up ? "up" : right ? "right" : left ? "left" : null;
    if (dir) {
      let next = this.bestInDirection(items, index, dir);
      // Vertical wraps top↔bottom (a familiar list feel); horizontal stops at the
      // edge so left/right never jumps rows.
      if (next === -1 && (dir === "up" || dir === "down")) {
        next = this.wrapVertical(items, index, dir);
      }
      if (next !== -1) this.setRing(items[next]);
    }

    const bindings = loadBindings();
    const aDown = this.buttonDown(pad, bindings.select.pad);
    if (aDown && !this.aWasDown) this.activate();
    this.aWasDown = aDown;

    const bDown = this.buttonDown(pad, bindings.back.pad);
    if (bDown && !this.bWasDown) this.escape();
    this.bWasDown = bDown;
  }

  /** Record the pad's current direction/A/B state WITHOUT acting on it, used while
   *  a rebind cell holds the capture lock. Any direction currently down is marked
   *  held with its repeat clock pushed out, so when the lock lifts mid-hold the
   *  next `tick()` won't mistake the still-pressed button for a fresh press. */
  private syncHeldSilently(pad: Gamepad) {
    const now = performance.now();
    const dy = this.axis(pad, 1);
    const dx = this.axis(pad, 0);
    const state: Record<Dir, boolean> = {
      up: dy < -AXIS_THRESHOLD || (pad.buttons[DPAD.up]?.pressed ?? false),
      down: dy > AXIS_THRESHOLD || (pad.buttons[DPAD.down]?.pressed ?? false),
      left: dx < -AXIS_THRESHOLD || (pad.buttons[DPAD.left]?.pressed ?? false),
      right: dx > AXIS_THRESHOLD || (pad.buttons[DPAD.right]?.pressed ?? false),
    };
    for (const dir of ["up", "down", "left", "right"] as Dir[]) {
      this.held[dir] = state[dir];
      this.nextFire[dir] = state[dir] ? now + REPEAT_DELAY_MS : 0;
    }
    const bindings = loadBindings();
    this.aWasDown = this.buttonDown(pad, bindings.select.pad);
    this.bWasDown = this.buttonDown(pad, bindings.back.pad);
  }

  /** Is the (possibly unbound) gamepad button index currently pressed? */
  private buttonDown(pad: Gamepad, button: number): boolean {
    if (button < 0) return false;
    return pad.buttons[button]?.pressed ?? false;
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

  /** Index of the nearest focusable lying in `dir` from the current one, or -1.
   *  A candidate must sit on the correct side along the primary axis; among those
   *  we prefer the one that overlaps the current element on the cross axis, then
   *  the closest. Falls back to any candidate on the correct side so a diagonal
   *  layout never strands the cursor. */
  private bestInDirection(items: HTMLElement[], index: number, dir: Dir): number {
    const cur = items[index].getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;
    const vertical = dir === "up" || dir === "down";
    const sign = dir === "down" || dir === "right" ? 1 : -1;

    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < items.length; i++) {
      if (i === index) continue;
      const r = items[i].getBoundingClientRect();
      const mx = r.left + r.width / 2;
      const my = r.top + r.height / 2;
      // Primary = distance along the pressed axis (must be on the correct side);
      // cross = misalignment on the other axis.
      const primary = (vertical ? my - cy : mx - cx) * sign;
      const cross = Math.abs(vertical ? mx - cx : my - cy);
      if (primary <= 1) continue; // not actually in this direction
      // Weight cross-axis misalignment heavily so we stay in the same column/row.
      const score = primary + cross * 3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** When a vertical step falls off the edge, wrap to the far end: pressing down
   *  at the bottom lands on the topmost item, up at the top lands on the bottom.
   *  Prefers the item best aligned with the current column so multi-column layouts
   *  wrap within their own column. `dir` is the press, so the target sits at the
   *  OPPOSITE extreme. */
  private wrapVertical(items: HTMLElement[], index: number, dir: Dir): number {
    const cur = items[index].getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    // Pressing "down" wraps to the topmost row (minimal y); "up" to the bottommost.
    const wantMinY = dir === "down";

    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < items.length; i++) {
      if (i === index) continue;
      const r = items[i].getBoundingClientRect();
      const my = r.top + r.height / 2;
      const mx = r.left + r.width / 2;
      const cross = Math.abs(mx - cx);
      // Rank by how far toward the target edge the item is, then column alignment.
      const edge = wantMinY ? my : -my;
      const score = edge + cross * 3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
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
