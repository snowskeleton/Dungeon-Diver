// The "rebind any key" screen — a table of Action | Key 1 | Key 2 where each
// cell is a button you click to capture the next keypress.
//
// Rules the screen enforces (normal game-menu contract):
//  - Bindings are globally unique. Assigning a key that's already used elsewhere
//    unbinds it there and warns which action lost it.
//  - Escape is never bindable, and pressing Escape mid-capture cancels it.
//  - Every cell has an Unbind (✕) button.
//  - Edits live in a draft; nothing persists until Save. Cancel discards.
//  - Trying to leave with unsaved edits (Escape) shows an error instead of
//    closing — you have to Save or Cancel.

import { addStyle, button, el, menuPanel } from "./menuDom";
import {
  BINDABLE_ACTIONS,
  BINDING_SLOTS,
  BindableAction,
  DEFAULT_BINDINGS,
  KeyBindings,
  cloneBindings,
  keyLabel,
  loadBindings,
  saveBindings,
} from "../options/keybindings";

const CSS = `
  .kb-table { display: flex; flex-direction: column; gap: 6px; }
  .kb-row {
    display: grid; grid-template-columns: 150px 1fr 1fr; gap: 10px;
    align-items: center; padding: 5px 0; border-bottom: 1px solid #2a2a4a;
  }
  .kb-head { color: #777799; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
  .kb-action { font-size: 12px; color: #ccccee; }
  .kb-cell { display: flex; gap: 6px; align-items: center; }
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
`;

const ESCAPE_CODE = 27;

/** Open the rebind screen. Resolves when the player leaves it (Save or Cancel);
 *  Save has already persisted by then, so callers need nothing back. */
export function showKeybindMenu(): Promise<void> {
  return new Promise((resolve) => {
    const saved = loadBindings();
    const draft: KeyBindings = cloneBindings(saved);

    // Only one cell captures at a time; the window listener below routes the next
    // keypress to it. Null means we're not capturing.
    let capturing: { action: BindableAction; slot: number } | null = null;

    const isDirty = () =>
      BINDABLE_ACTIONS.some(({ action }) =>
        draft[action][0] !== saved[action][0] || draft[action][1] !== saved[action][1]);

    const finish = () => {
      window.removeEventListener("keydown", onCapture, true);
      menu.destroy();
      resolve();
    };

    // Escape at the panel level: cancel a capture first, else refuse to leave
    // with unsaved edits (that's the "show an error" rule), else close.
    const onEscape = () => {
      if (capturing) {
        capturing = null;
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

    // The one key-capture listener, on the window in capture phase so it beats
    // Phaser (whose canvas has focus during a run). Active only while `capturing`.
    const onCapture = (e: KeyboardEvent) => {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();
      // Clear `capturing` BEFORE assign() — assign re-renders, and a still-set
      // `capturing` would draw the target cell as "…" instead of the new key.
      const target = capturing;
      capturing = null;
      if (e.keyCode === ESCAPE_CODE || e.key === "Escape") {
        note("Rebind cancelled.", "info");
        render();
        return;
      }
      assign(target.action, target.slot, e.keyCode);
    };
    window.addEventListener("keydown", onCapture, true);

    // Put `code` in one cell, first stripping it from wherever else it lived so a
    // key is never bound to two things — and say what lost it.
    const assign = (action: BindableAction, slot: number, code: number) => {
      const prior = findBinding(draft, code);
      if (prior && prior.action === action && prior.slot === slot) {
        note("", "info"); // Re-bound to the same cell; no-op.
        render();
        return;
      }
      if (prior) draft[prior.action][prior.slot] = 0;
      draft[action][slot] = code;

      if (prior) {
        note(`${keyLabel(code)} was on "${labelOf(prior.action)}" — unbound it there.`, "info");
      } else {
        note("", "info");
      }
      render();
    };

    const clear = (action: BindableAction, slot: number) => {
      draft[action][slot] = 0;
      note("", "info");
      render();
    };

    const beginCapture = (action: BindableAction, slot: number) => {
      capturing = { action, slot };
      note("Press any key…  (Esc to cancel)", "info");
      render();
    };

    const table = el("div", { className: "kb-table" });
    const render = () => {
      const rows: HTMLElement[] = [
        el("div", { className: "kb-row" }, [
          el("div", { className: "kb-head", text: "Action" }),
          el("div", { className: "kb-head", text: "Key 1" }),
          el("div", { className: "kb-head", text: "Key 2" }),
        ]),
      ];
      for (const { action, label } of BINDABLE_ACTIONS) {
        const cells: HTMLElement[] = [el("div", { className: "kb-action", text: label })];
        for (let slot = 0; slot < BINDING_SLOTS; slot++) {
          cells.push(cell(action, slot));
        }
        rows.push(el("div", { className: "kb-row" }, cells));
      }
      table.replaceChildren(...rows);
    };

    const cell = (action: BindableAction, slot: number): HTMLElement => {
      const code = draft[action][slot];
      const active = capturing?.action === action && capturing.slot === slot;
      const keyBtn = el("button", {
        className: `kb-key${active ? " capturing" : ""}${!code && !active ? " empty" : ""}`,
        text: active ? "…" : keyLabel(code),
        onClick: () => beginCapture(action, slot),
      });
      const clearBtn = el("button", {
        className: "kb-clear",
        text: "✕",
        onClick: () => clear(action, slot),
      });
      clearBtn.title = "Unbind";
      return el("div", { className: "kb-cell" }, [keyBtn, clearBtn]);
    };

    render();

    menu.panel.append(
      el("h2", { className: "m-title", text: "Key Bindings" }),
      el("p", {
        className: "m-sub",
        text: "Click a key, then press the key to bind. Esc cancels a rebind and is reserved.",
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
  return BINDABLE_ACTIONS.find((a) => a.action === action)?.label ?? action;
}

/** Where a keycode currently lives in the draft, or null if free. */
function findBinding(
  bindings: KeyBindings,
  code: number,
): { action: BindableAction; slot: number } | null {
  for (const { action } of BINDABLE_ACTIONS) {
    for (let slot = 0; slot < BINDING_SLOTS; slot++) {
      if (bindings[action][slot] === code) return { action, slot };
    }
  }
  return null;
}
