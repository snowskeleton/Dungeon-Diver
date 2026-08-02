// The "rebind any control" screen — a table of Action | Keyboard/Mouse | Controller.
// The keyboard column holds two interchangeable key cells (primary + secondary);
// the controller column holds one gamepad-button cell (or a fixed "L-Stick" tag for
// movement, which is the analog stick and not a rebindable button). Each cell is a
// button you click, then press the key / gamepad button to bind.
//
// Rules the screen enforces (normal game-menu contract):
//  - Bindings are unique WITHIN a device: a key is never bound to two actions, and
//    neither is a gamepad button (the two live in separate namespaces, so a key and
//    a button never collide). Reassigning steals it and warns which action lost it.
//  - Escape is never bindable, and pressing Escape mid-capture cancels it.
//  - Every cell has an Unbind (✕) button.
//  - Edits live in a draft; nothing persists until Save. Cancel discards.
//  - Trying to leave with unsaved edits (Escape) shows an error instead of closing.

import { addStyle, button, el, menuPanel } from "./menuDom";
import { setGamepadCaptureLock } from "./GamepadMenuCursor";
import {
  ALL_BINDING_ROWS,
  BINDABLE_ACTIONS,
  BINDING_SLOTS,
  BindableAction,
  DEFAULT_BINDINGS,
  KeyBindings,
  PAD_UNBOUND,
  RESERVED_ROWS,
  cloneBindings,
  isMovementAction,
  isReservedAction,
  keyLabel,
  loadBindings,
  padLabel,
  saveBindings,
} from "../options/keybindings";

const CSS = `
  .kb-table { display: flex; flex-direction: column; gap: 6px; }
  .kb-row {
    display: grid; grid-template-columns: 150px 1.4fr 1fr; gap: 10px;
    align-items: center; padding: 5px 0; border-bottom: 1px solid #2a2a4a;
  }
  .kb-head { color: #777799; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
  .kb-action { font-size: 12px; color: #ccccee; }
  .kb-group { display: flex; gap: 6px; }
  .kb-cell { display: flex; gap: 4px; align-items: center; flex: 1; min-width: 0; }
  .kb-key {
    flex: 1; min-width: 0; padding: 6px 8px; font-size: 12px; font-family: monospace;
    cursor: pointer; border-radius: 4px; border: 1px solid #4a4a6a;
    background: #12121f; color: #e0e0ff; text-align: center;
  }
  .kb-key:hover { border-color: #8888cc; background: #1a1a2e; }
  .kb-key.capturing { border-color: #f6e05e; color: #f6e05e; background: #2a2a1a; }
  .kb-key.empty { color: #666688; }
  .kb-clear {
    flex: 0 0 auto; padding: 6px 8px; font-size: 11px; line-height: 1; cursor: pointer;
    border-radius: 4px; border: 1px solid #4a4a6a; background: #20203a; color: #9999bb;
  }
  .kb-clear:hover { border-color: #ff6b6b; color: #ff6b6b; }
  .kb-fixed { flex: 1; padding: 6px 8px; font-size: 12px; color: #8888aa; text-align: center; }
  .kb-row.reserved { opacity: 0.55; }
  .kb-locked {
    flex: 1; min-width: 0; padding: 6px 8px; font-size: 12px; font-family: monospace;
    border-radius: 4px; border: 1px dashed #3a3a5a; background: #12121f; color: #8888aa;
    text-align: center; cursor: not-allowed;
  }
`;

const ESCAPE_CODE = 27;

// What's mid-capture: a keyboard cell (which slot) or the controller cell.
type Capturing =
  | { action: BindableAction; device: "kbd"; slot: number }
  | { action: BindableAction; device: "pad" }
  | null;

/** Open the rebind screen. Resolves when the player leaves it (Save or Cancel);
 *  Save has already persisted by then, so callers need nothing back. */
export function showKeybindMenu(): Promise<void> {
  return new Promise((resolve) => {
    const saved = loadBindings();
    const draft: KeyBindings = cloneBindings(saved);

    let capturing: Capturing = null;
    // Cleanup for an in-flight controller-button poll, if any.
    let stopPadCapture: (() => void) | null = null;

    const isDirty = () =>
      BINDABLE_ACTIONS.some(({ action }) =>
        draft[action].keys[0] !== saved[action].keys[0] ||
        draft[action].keys[1] !== saved[action].keys[1] ||
        draft[action].pad !== saved[action].pad);

    const finish = () => {
      window.removeEventListener("keydown", onCapture, true);
      cancelPadCapture();
      menu.destroy();
      resolve();
    };

    // Escape at the panel level: cancel a capture first, else refuse to leave with
    // unsaved edits (the "show an error" rule), else close.
    const onEscape = () => {
      if (capturing) {
        cancelCapture();
        note("", "info");
        render();
        return;
      }
      if (isDirty()) {
        note("Unsaved changes — Save or Cancel to leave.", "error");
        return;
      }
      finish();
    };

    const menu = menuPanel({
      variant: "wide",
      onEscape,
      swallowKeys: true,
    });
    addStyle("kb-style", CSS);

    const noteEl = el("div", { className: "m-note" });
    const note = (text: string, kind: "error" | "info") => {
      noteEl.textContent = text;
      noteEl.className = `m-note${kind === "info" ? " info" : ""}`;
    };

    const cancelPadCapture = () => {
      stopPadCapture?.();
      stopPadCapture = null;
      setGamepadCaptureLock(false);
    };

    // Drop whatever capture is in progress (Escape, or starting a different one).
    const cancelCapture = () => {
      capturing = null;
      cancelPadCapture();
    };

    // ── Keyboard capture ──────────────────────────────────────────────────────
    // One key-capture listener, on the window in capture phase so it beats Phaser
    // (whose canvas has focus during a run). Active only while a kbd cell captures.
    const onCapture = (e: KeyboardEvent) => {
      if (capturing?.device !== "kbd") return;
      e.preventDefault();
      e.stopPropagation();
      const target = capturing;
      capturing = null;
      if (e.keyCode === ESCAPE_CODE || e.key === "Escape") {
        note("Rebind cancelled.", "info");
        render();
        return;
      }
      assignKey(target.action, target.slot, e.keyCode);
    };
    window.addEventListener("keydown", onCapture, true);

    // ── Controller capture ────────────────────────────────────────────────────
    // Poll the first connected pad. Arm only once every button is released (so the
    // A press that clicked the cell isn't itself captured), then take the next press.
    const beginPadCapture = (action: BindableAction) => {
      cancelCapture();
      capturing = { action, device: "pad" };
      note("Press a controller button…  (Esc to cancel)", "info");
      render();
      setGamepadCaptureLock(true);

      let armed = false;
      let raf = 0;
      const poll = () => {
        if (capturing?.device !== "pad") return; // cancelled elsewhere
        const pad = (navigator.getGamepads?.() ?? []).find((p) => p) ?? null;
        if (pad) {
          const pressed = pad.buttons.findIndex((b) => b.pressed);
          if (!armed) {
            if (pressed === -1) armed = true; // wait for a clean release first
          } else if (pressed !== -1) {
            const target = capturing.action;
            capturing = null;
            cancelPadCapture();
            assignPad(target, pressed);
            return;
          }
        }
        raf = requestAnimationFrame(poll);
      };
      raf = requestAnimationFrame(poll);
      stopPadCapture = () => cancelAnimationFrame(raf);
    };

    // ── Assignment (steal-on-conflict, within each device's namespace) ─────────
    const assignKey = (action: BindableAction, slot: number, code: number) => {
      const prior = findKey(draft, code);
      if (prior && prior.action === action && prior.slot === slot) {
        note("", "info");
        render();
        return;
      }
      if (prior && isReservedAction(prior.action)) {
        note(`${keyLabel(code)} is reserved for "${labelOf(prior.action)}".`, "error");
        render();
        return;
      }
      if (prior) draft[prior.action].keys[prior.slot] = 0;
      draft[action].keys[slot] = code;
      note(
        prior ? `${keyLabel(code)} was on "${labelOf(prior.action)}" — moved it here.` : "",
        "info",
      );
      render();
    };

    const assignPad = (action: BindableAction, button: number) => {
      const prior = findPad(draft, button);
      if (prior === action) {
        note("", "info");
        render();
        return;
      }
      if (prior && isReservedAction(prior)) {
        note(`${padLabel(button)} is reserved for "${labelOf(prior)}".`, "error");
        render();
        return;
      }
      if (prior) draft[prior].pad = PAD_UNBOUND;
      draft[action].pad = button;
      note(
        prior ? `${padLabel(button)} was on "${labelOf(prior)}" — moved it here.` : "",
        "info",
      );
      render();
    };

    const clearKey = (action: BindableAction, slot: number) => {
      draft[action].keys[slot] = 0;
      note("", "info");
      render();
    };
    const clearPad = (action: BindableAction) => {
      draft[action].pad = PAD_UNBOUND;
      note("", "info");
      render();
    };

    const beginKeyCapture = (action: BindableAction, slot: number) => {
      cancelCapture();
      capturing = { action, device: "kbd", slot };
      note("Press any key…  (Esc to cancel)", "info");
      render();
    };

    // ── Render ────────────────────────────────────────────────────────────────
    const table = el("div", { className: "kb-table" });
    const render = () => {
      const rows: HTMLElement[] = [
        el("div", { className: "kb-row" }, [
          el("div", { className: "kb-head", text: "Action" }),
          el("div", { className: "kb-head", text: "Keyboard / Mouse" }),
          el("div", { className: "kb-head", text: "Controller" }),
        ]),
      ];
      for (const { action, label } of BINDABLE_ACTIONS) {
        const keyCells: HTMLElement[] = [];
        for (let slot = 0; slot < BINDING_SLOTS; slot++) keyCells.push(keyCell(action, slot));
        rows.push(
          el("div", { className: "kb-row" }, [
            el("div", { className: "kb-action", text: label }),
            el("div", { className: "kb-group" }, keyCells),
            padCell(action),
          ]),
        );
      }
      // Reserved rows are read-only: shown so players can see the fixed control, but
      // greyed and unclickable (no capture, no unbind).
      for (const { action, label } of RESERVED_ROWS) {
        rows.push(
          el("div", { className: "kb-row reserved" }, [
            el("div", { className: "kb-action", text: label }),
            el("div", { className: "kb-group" }, [
              el("div", { className: "kb-locked", text: keyLabel(draft[action].keys[0] || draft[action].keys[1]) }),
            ]),
            el("div", { className: "kb-cell" }, [
              el("div", { className: "kb-locked", text: padLabel(draft[action].pad) }),
            ]),
          ]),
        );
      }
      table.replaceChildren(...rows);
    };

    const keyCell = (action: BindableAction, slot: number): HTMLElement => {
      const code = draft[action].keys[slot];
      const active = capturing?.device === "kbd" && capturing.action === action && capturing.slot === slot;
      const keyBtn = el("button", {
        className: `kb-key${active ? " capturing" : ""}${!code && !active ? " empty" : ""}`,
        text: active ? "…" : keyLabel(code),
        onClick: () => beginKeyCapture(action, slot),
      });
      const clearBtn = el("button", { className: "kb-clear", text: "✕", onClick: () => clearKey(action, slot) });
      clearBtn.title = "Unbind";
      return el("div", { className: "kb-cell" }, [keyBtn, clearBtn]);
    };

    const padCell = (action: BindableAction): HTMLElement => {
      // Movement is the analog left stick — nothing to bind.
      if (isMovementAction(action)) {
        return el("div", { className: "kb-cell" }, [el("div", { className: "kb-fixed", text: "L-Stick" })]);
      }
      const button = draft[action].pad;
      const active = capturing?.device === "pad" && capturing.action === action;
      const padBtn = el("button", {
        className: `kb-key${active ? " capturing" : ""}${button < 0 && !active ? " empty" : ""}`,
        text: active ? "…" : padLabel(button),
        onClick: () => beginPadCapture(action),
      });
      const clearBtn = el("button", { className: "kb-clear", text: "✕", onClick: () => clearPad(action) });
      clearBtn.title = "Unbind";
      return el("div", { className: "kb-cell" }, [padBtn, clearBtn]);
    };

    render();

    menu.panel.append(
      el("h2", { className: "m-title", text: "Controls" }),
      el("p", {
        className: "m-sub",
        text: "Click a cell, then press the key or controller button to bind. Esc cancels a rebind and is reserved. Movement on a controller is the left stick.",
      }),
      el("div", { className: "m-scroll" }, [table]),
      noteEl,
      el("div", { className: "m-actions end" }, [
        button("Reset to Defaults", () => {
          Object.assign(draft, cloneBindings(DEFAULT_BINDINGS));
          note("Reset to defaults — Save to keep.", "info");
          render();
        }),
        button("Cancel", () => finish()),
        button("Save", () => {
          saveBindings(draft);
          finish();
        }, "primary"),
      ]),
    );
  });
}

function labelOf(action: BindableAction): string {
  return ALL_BINDING_ROWS.find((a) => a.action === action)?.label ?? action;
}

/** Which keyboard cell a keycode currently lives in, or null if free. Reserved
 *  rows are included so a reserved key reads as occupied (and is protected). */
function findKey(
  bindings: KeyBindings,
  code: number,
): { action: BindableAction; slot: number } | null {
  for (const { action } of ALL_BINDING_ROWS) {
    for (let slot = 0; slot < BINDING_SLOTS; slot++) {
      if (bindings[action].keys[slot] === code) return { action, slot };
    }
  }
  return null;
}

/** Which action a gamepad button is currently bound to, or null if free. Reserved
 *  rows are included so a reserved button reads as occupied (and is protected). */
function findPad(bindings: KeyBindings, button: number): BindableAction | null {
  for (const { action } of ALL_BINDING_ROWS) {
    if (!isMovementAction(action) && bindings[action].pad === button) return action;
  }
  return null;
}
