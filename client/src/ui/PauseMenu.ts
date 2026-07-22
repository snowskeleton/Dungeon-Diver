import { el, button, menuPanel, MenuPanel } from "./menuDom";

/**
 * The pause menu the first playtest asked for (decision D7): "you can pause, but
 * you can never unpause".
 *
 * Escape used to quit the run outright — one reflexive keypress ended a live
 * co-op session. The stopgap made Escape peel overlays and put a confirm in
 * front of quitting; this is the real thing. Escape opens a menu you can RESUME
 * from, and abandoning a run is a labelled choice inside it rather than the
 * default meaning of the key.
 *
 * It deliberately does not pause the world by itself — GameScene pauses the room
 * around it, the same way the inventory menu does, so there is one pause concept
 * and not two.
 */
export interface PauseMenuHandlers {
  onResume(): void;
  onInventory(): void;
  onOptions(): void;
  onAbandon(): void;
}

export class PauseMenu {
  private menu: MenuPanel | null = null;

  get isOpen(): boolean {
    return this.menu !== null;
  }

  show(handlers: PauseMenuHandlers, opts: { roomCode: string; floor: number; partySize: number }) {
    if (this.menu) return;
    const menu = menuPanel({ narrow: true, onEscape: () => handlers.onResume() });
    this.menu = menu;

    const party = opts.partySize === 1 ? "solo" : `${opts.partySize} players`;
    menu.panel.append(
      el("h2", { className: "m-title", text: "PAUSED" }),
      el("p", {
        className: "m-sub",
        text: `Floor ${opts.floor} · ${party} · room ${opts.roomCode}`,
      }),
      this.item("Resume", handlers.onResume, "primary"),
      this.item("Inventory & stats", handlers.onInventory),
      this.item("Options", handlers.onOptions),
      this.item("Abandon run", handlers.onAbandon, "danger"),
      el("p", { className: "m-sub", text: "Esc resumes. The whole party is paused while this is open." }),
    );
  }

  /** Menu entries are full-width buttons rather than a list with a cursor: this
   *  menu is reached mid-fight, and a mouse target beats remembering an index. */
  private item(label: string, onClick: () => void, variant: "" | "primary" | "danger" = ""): HTMLElement {
    const btn = button(label, onClick, variant);
    btn.style.width = "100%";
    return btn;
  }

  hide() {
    this.menu?.destroy();
    this.menu = null;
  }
}
