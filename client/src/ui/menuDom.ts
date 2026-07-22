/**
 * The shared look for every full-screen DOM overlay in the game — the browser,
 * the lobby, the pause menu, the pickers, the inventory, the settings panels.
 *
 * Phaser draws the world; menus are DOM, because a room list with a text input
 * and a scrolling roster is a form, and hand-laying one out in canvas text
 * objects buys nothing. This module is the one stylesheet + the handful of
 * builders they all share.
 *
 * **A panel's own file should only add CSS for what makes that panel different**
 * — the character portraits' spritesheet cropping, the weapon-category tabs, the
 * confirm dialog's red framing. Anything an overlay, a panel, a row, a button, a
 * tile, a card, a chip or an input looks like belongs here, or the six near-
 * identical copies this file replaced grow back one panel at a time. Per-file
 * additions go through `addStyle()`, which keys on an id so it injects once.
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
  .m-panel.wide { width: 680px; }
  /* Sized by its contents — for a panel whose row of cards IS its width. */
  .m-panel.auto { width: auto; }
  .m-panel.gold { border-color: #ffe066; }
  .m-panel.center { text-align: center; }
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
  .m-row.active { border-color: #ffe066; background: #2a2a4a; }
  .m-grow { flex: 1; min-width: 0; }
  .m-row-name { font-size: 13px; color: #fff; }
  .m-row-name .m-badge { margin-left: 6px; }
  .m-row-detail { font-size: 11px; color: #99aacc; margin-top: 3px; }
  .m-row-detail span { display: inline-block; margin-right: 12px; }
  .m-empty { font-size: 12px; color: #777799; text-align: center; padding: 20px 0; }
  .m-icon-box {
    flex: 0 0 44px; width: 44px; height: 44px; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .m-icon-box img, .m-icon { image-rendering: pixelated; display: block; }
  /* A grid of pick-one things: skins, weapon icons, reward cards' siblings. */
  .m-tiles { display: flex; flex-wrap: wrap; gap: 8px; }
  .m-tile {
    cursor: pointer; padding: 6px; border: 2px solid #4a4a6a; border-radius: 6px;
    background: #20203a; color: #ccccee;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  /* Frameless until picked — for tiles that are all art, where a resting border
     would fight the sprite for attention. Declared before the hover/selected
     rules so those still win when one of these is picked. */
  .m-tile.bare { background: none; border-color: transparent; }
  .m-tile:hover { border-color: #6666bb; }
  .m-tile.selected { border-color: #8888ff; background: #33335e; color: #fff; }
  .m-tile.grow { flex: 1; }
  .m-tile-name { font-size: 12px; font-weight: bold; text-align: center; }
  .m-tile-detail {
    font-size: 10px; color: #8888aa; line-height: 1.4;
    text-align: center; white-space: pre-line;
  }
  .m-cards { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .m-card {
    width: 190px; padding: 12px; border: 1px solid #4a4a6a; border-radius: 6px;
    background: #20203a; cursor: pointer; text-align: left;
    display: flex; flex-direction: column; gap: 6px;
  }
  .m-card:hover { border-color: #6666bb; background: #2a2a4a; }
  .m-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .m-chip {
    padding: 4px 10px; font-size: 11px; font-family: monospace; cursor: pointer;
    background: #2a2a4a; border: 1px solid #4a4a6a; border-radius: 4px; color: #aaaacc;
  }
  .m-chip:hover { border-color: #8888ff; color: #fff; }
  .m-chip.on { background: #4a4aaa; border-color: #8888ff; color: #fff; }
  .m-chip.round { border-radius: 12px; }
  .m-badge {
    font-size: 10px; padding: 2px 6px; border-radius: 3px;
    background: #33335e; color: #aaaacc; white-space: nowrap;
  }
  .m-badge.gold, .m-badge.host { background: #f6e05e; color: #1a1a2e; }
  .m-badge.ready { background: #48bb78; color: #10221a; }
  .m-badge.waiting { background: #3a3a5a; color: #9999bb; }
  .m-actions { display: flex; gap: 8px; align-items: center; }
  .m-actions.end { justify-content: flex-end; }
  .m-actions.center { justify-content: center; }
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
  .m-btn.full { width: 100%; }
  .m-input {
    padding: 7px 10px; font-size: 12px; font-family: monospace;
    border-radius: 4px; border: 1px solid #4a4a6a; background: #12121f; color: #e0e0ff;
  }
  .m-input:focus { outline: none; border-color: #8888ff; }
  .m-input.code { letter-spacing: 4px; text-transform: uppercase; width: 110px; }
  .m-input.fill { width: 100%; }
  .m-input[type="checkbox"] { width: 16px; height: 16px; padding: 0; accent-color: #6666dd; }
  .m-hint { font-size: 11px; color: #7777aa; }
  .m-note { font-size: 11px; min-height: 15px; color: #ff8888; }
  .m-note.info { color: #99aacc; }
  .m-field { display: flex; gap: 8px; align-items: center; }
  .m-field label { font-size: 11px; color: #777799; }
  .m-checkbox { display: flex; gap: 6px; align-items: center; font-size: 11px; color: #99aacc; cursor: pointer; }
`;

/** Inject a stylesheet once, keyed by id. The shared CSS below and every panel's
 *  own handful of extra rules both arrive this way, so a panel shown four times
 *  adds four `<style>` tags exactly zero times. */
export function addStyle(id: string, css: string) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureStyle() {
  addStyle("m-menu-style", CSS);
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

/** Move the `.selected` marker to one tile in a group. Selection is a class on
 *  the DOM rather than a re-render because these grids hold sprite images, and
 *  rebuilding them restarts every decode on each click. */
export function selectOne(group: HTMLElement, chosen: HTMLElement) {
  group.querySelectorAll(".selected").forEach((node) => node.classList.remove("selected"));
  chosen.classList.add("selected");
}

/** A full-screen panel. `destroy()` removes it and its key handler — every menu
 *  here is torn down on a scene shutdown, so leaving either behind would stack a
 *  second copy on the next visit. */
export interface MenuPanel {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  destroy(): void;
}

export interface MenuPanelOptions {
  /** Extra classes on `.m-panel` — a size (`narrow`/`wide`/`auto`) and any
   *  accent the panel wants (`gold`, `center`). */
  variant?: string;
  onEscape?: () => void;
  /** Stop EVERY keydown reaching Phaser, not just Escape. For panels with text
   *  fields or a lot of keys behind them; without it, typing a number into a
   *  debug field also drives the player. */
  swallowKeys?: boolean;
  /** Above the default 1000, for a panel that opens on top of another one. */
  zIndex?: number;
}

export function menuPanel(opts: MenuPanelOptions): MenuPanel {
  ensureStyle();
  const panel = el("div", { className: `m-panel ${opts.variant ?? ""}`.trim() });
  const overlay = el("div", { className: "m-overlay" }, [panel]);
  if (opts.zIndex !== undefined) overlay.style.zIndex = String(opts.zIndex);

  // Captured on the window: Phaser's canvas has focus and its own Escape
  // handling, and the menu on screen is the thing the key means.
  const onKey = (e: KeyboardEvent) => {
    if (opts.swallowKeys) e.stopPropagation();
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
