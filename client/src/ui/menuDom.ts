/**
 * The shared look for full-screen DOM menus (browser, lobby, pause).
 *
 * Phaser draws the world; menus are DOM, because a room list with a text input
 * and a scrolling roster is a form, and hand-laying one out in canvas text
 * objects buys nothing. This module is the one stylesheet + the handful of
 * builders they share.
 *
 * The older overlays (CharacterPicker, WeaponPicker, InventoryMenu, OfferPicker,
 * ConfirmDialog, FieldPanel) each carry their own near-identical copy of this
 * CSS. They predate this file and are deliberately left alone here — folding
 * them in is a worthwhile cleanup, but it is a cleanup, not part of the menu
 * system, and it would bury this change in unrelated diff.
 */

const CSS = `
  .m-overlay {
    position: fixed; inset: 0; background: rgba(6,6,16,0.92);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; font-family: monospace; color: #e0e0ff;
  }
  .m-panel {
    background: #1a1a2e; border: 2px solid #4a4a6a; border-radius: 8px;
    padding: 22px; width: 560px; max-width: 92vw; max-height: 88vh;
    display: flex; flex-direction: column; gap: 14px;
  }
  .m-panel.narrow { width: 400px; }
  .m-title { margin: 0; font-size: 18px; color: #f6e05e; letter-spacing: 2px; }
  .m-sub { margin: 0; font-size: 11px; color: #777799; line-height: 1.6; }
  .m-heading {
    margin: 0; font-size: 11px; color: #777799; letter-spacing: 1px;
    text-transform: uppercase;
  }
  .m-scroll { overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 60px; }
  .m-row {
    display: flex; align-items: center; gap: 12px; padding: 10px;
    border: 1px solid #333355; border-radius: 6px; background: #20203a;
  }
  .m-row.clickable { cursor: pointer; }
  .m-row.clickable:hover { border-color: #6666bb; background: #26264a; }
  .m-row.you { border-color: #8888ff; }
  .m-grow { flex: 1; min-width: 0; }
  .m-row-name { font-size: 13px; color: #fff; }
  .m-row-detail { font-size: 11px; color: #99aacc; margin-top: 3px; }
  .m-empty { font-size: 12px; color: #777799; text-align: center; padding: 20px 0; }
  .m-badge {
    font-size: 10px; padding: 2px 6px; border-radius: 3px;
    background: #33335e; color: #aaaacc; white-space: nowrap;
  }
  .m-badge.host { background: #f6e05e; color: #1a1a2e; }
  .m-badge.ready { background: #48bb78; color: #10221a; }
  .m-badge.waiting { background: #3a3a5a; color: #9999bb; }
  .m-actions { display: flex; gap: 8px; align-items: center; }
  .m-actions.end { justify-content: flex-end; }
  .m-btn {
    padding: 7px 16px; font-size: 12px; font-family: monospace; cursor: pointer;
    border-radius: 4px; border: 1px solid #4a4a6a; background: #2a2a4a; color: #ccccee;
  }
  .m-btn:hover:not(:disabled) { border-color: #8888cc; background: #33335e; }
  .m-btn:disabled { opacity: 0.45; cursor: default; }
  .m-btn.primary { background: #4a4aaa; color: #fff; border-color: #8888ff; }
  .m-btn.danger { border-color: #ff6b6b; color: #ff6b6b; }
  .m-btn.danger:hover:not(:disabled) { background: #3a2030; }
  .m-btn.small { padding: 4px 10px; font-size: 11px; }
  .m-input {
    padding: 7px 10px; font-size: 12px; font-family: monospace;
    border-radius: 4px; border: 1px solid #4a4a6a; background: #12121f; color: #e0e0ff;
  }
  .m-input:focus { outline: none; border-color: #8888ff; }
  .m-input.code { letter-spacing: 4px; text-transform: uppercase; width: 110px; }
  .m-note { font-size: 11px; min-height: 15px; color: #ff8888; }
  .m-note.info { color: #99aacc; }
  .m-field { display: flex; gap: 8px; align-items: center; }
  .m-field label { font-size: 11px; color: #777799; }
  .m-checkbox { display: flex; gap: 6px; align-items: center; font-size: 11px; color: #99aacc; cursor: pointer; }
`;

function ensureStyle() {
  if (document.getElementById("m-menu-style")) return;
  const style = document.createElement("style");
  style.id = "m-menu-style";
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Create an element with a class, text and/or listeners in one call — these
 *  panels are mostly small labelled boxes, and the builder keeps the structure
 *  of a panel readable instead of drowning it in three lines per node. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: {
    className?: string;
    text?: string;
    html?: string;
    onClick?: () => void;
  } = {},
  children: HTMLElement[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.onClick) node.addEventListener("click", opts.onClick);
  for (const child of children) node.appendChild(child);
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  variant: "" | "primary" | "danger" = "",
): HTMLButtonElement {
  return el("button", { className: `m-btn ${variant}`.trim(), text: label, onClick });
}

/** A full-screen panel. `destroy()` removes it and its key handler — every menu
 *  here is torn down on a scene shutdown, so leaving either behind would stack a
 *  second copy on the next visit. */
export interface MenuPanel {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  destroy(): void;
}

export function menuPanel(opts: { narrow?: boolean; onEscape?: () => void }): MenuPanel {
  ensureStyle();
  const panel = el("div", { className: `m-panel${opts.narrow ? " narrow" : ""}` });
  const overlay = el("div", { className: "m-overlay" }, [panel]);

  // Captured on the window: Phaser's canvas has focus and its own Escape
  // handling, and the menu on screen is the thing the key means.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !opts.onEscape) return;
    e.stopPropagation();
    e.preventDefault();
    opts.onEscape();
  };
  window.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);

  return {
    overlay,
    panel,
    destroy() {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
    },
  };
}
