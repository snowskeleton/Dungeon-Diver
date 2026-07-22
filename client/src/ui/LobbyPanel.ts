import { CHARACTER_REGISTRY, WEAPON_REGISTRY, CharacterClass, CharacterType, MAX_PLAYER_NAME_LEN } from "shared";
import { el, button, menuPanel, MenuPanel } from "./menuDom";

/** One line in the roster, flattened from the room's PlayerState. */
export interface LobbySeat {
  sessionId: string;
  name: string;
  characterClass: CharacterClass;
  characterType: CharacterType;
  weaponId: string;
  ready: boolean;
  isHost: boolean;
  /** Which local seat this is (0 = P1 on this machine), or -1 for someone else's. */
  localIndex: number;
}

export interface LobbyView {
  roomName: string;
  roomCode: string;
  isPrivate: boolean;
  seats: LobbySeat[];
  /** True if THIS machine's first player holds the Start button. */
  isHost: boolean;
  /** Names the host is still waiting on — empty means Start is live. */
  waitingOn: string[];
  canAddCouch: boolean;
  /** P1's own ready flag, for the non-host toggle. */
  ready: boolean;
}

export interface LobbyHandlers {
  onRename(name: string): void;
  onChangeLoadout(localIndex: number): void;
  onReady(ready: boolean): void;
  onStart(): void;
  onAddCouch(): void;
  onLeave(): void;
}

/**
 * The party staging panel: who is here, what they picked, and the one button
 * that turns a room into a run.
 *
 * Re-rendered on every state patch, but only the roster is rebuilt — the name
 * input is created once and left alone, because replacing a focused input on
 * each keystroke's echo would fight the player for their own cursor.
 */
export class LobbyPanel {
  private readonly menu: MenuPanel;
  private readonly handlers: LobbyHandlers;
  private readonly nameInput: HTMLInputElement;
  private readonly heading: HTMLHeadingElement;
  private readonly codeLine: HTMLParagraphElement;
  private readonly roster: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly note: HTMLDivElement;

  constructor(handlers: LobbyHandlers, initialName: string) {
    this.handlers = handlers;
    this.menu = menuPanel({ onEscape: () => handlers.onLeave() });

    this.heading = el("h2", { className: "m-title", text: "Lobby" });
    this.codeLine = el("p", { className: "m-sub" });

    this.nameInput = el("input", { className: "m-input m-grow" });
    this.nameInput.value = initialName;
    this.nameInput.maxLength = MAX_PLAYER_NAME_LEN;
    this.nameInput.addEventListener("change", () => handlers.onRename(this.nameInput.value));
    this.nameInput.addEventListener("blur", () => handlers.onRename(this.nameInput.value));

    this.roster = el("div", { className: "m-scroll" });
    this.actions = el("div", { className: "m-actions" });
    // Two message lines, on purpose: the hint is recomputed on every state patch
    // ("waiting on Bo"), so a server refusal sharing it would be wiped by the
    // next patch — often before it had been read.
    this.hint = el("div", { className: "m-note info" });
    this.note = el("div", { className: "m-note" });

    this.menu.panel.append(
      this.heading,
      this.codeLine,
      el("div", { className: "m-field" }, [
        el("label", { text: "Name" }),
        this.nameInput,
      ]),
      el("h3", { className: "m-heading", text: "Party" }),
      this.roster,
      this.hint,
      this.note,
      this.actions,
    );
  }

  render(view: LobbyView) {
    this.heading.textContent = view.roomName;
    this.codeLine.textContent = view.isPrivate
      ? `Private · join code ${view.roomCode} · ${view.seats.length}/4 players`
      : `Public · join code ${view.roomCode} · ${view.seats.length}/4 players`;

    this.roster.replaceChildren(...view.seats.map((seat) => this.seatRow(seat)));
    this.renderActions(view);
  }

  private seatRow(seat: LobbySeat): HTMLElement {
    const charName = CHARACTER_REGISTRY[seat.characterClass]?.name ?? seat.characterClass;
    const weaponName = WEAPON_REGISTRY[seat.weaponId as never]?.name ?? seat.weaponId;
    const isLocal = seat.localIndex >= 0;

    const badges: HTMLElement[] = [];
    if (seat.isHost) badges.push(el("span", { className: "m-badge host", text: "HOST" }));
    if (isLocal) badges.push(el("span", { className: "m-badge", text: `YOU · P${seat.localIndex + 1}` }));
    badges.push(
      seat.ready || seat.isHost
        ? el("span", { className: "m-badge ready", text: "READY" })
        : el("span", { className: "m-badge waiting", text: "WAITING" }),
    );

    const info = el("div", { className: "m-grow" }, [
      el("div", { className: "m-row-name", text: seat.name }),
      el("div", { className: "m-row-detail", text: `${charName} · ${weaponName}` }),
    ]);

    const row = el("div", { className: `m-row${isLocal ? " you" : ""}` }, [info, ...badges]);
    if (isLocal) {
      const change = button("Change", () => this.handlers.onChangeLoadout(seat.localIndex));
      change.classList.add("small");
      row.appendChild(change);
    }
    return row;
  }

  private renderActions(view: LobbyView) {
    const children: HTMLElement[] = [];

    const leave = button("Leave", () => this.handlers.onLeave());
    children.push(leave);

    if (view.canAddCouch) {
      const couch = button("+ Couch player (P)", () => this.handlers.onAddCouch());
      children.push(couch);
    }

    children.push(el("div", { className: "m-grow" }));

    if (view.isHost) {
      const start = button("Start run", () => this.handlers.onStart(), "primary");
      start.disabled = view.waitingOn.length > 0;
      if (start.disabled) start.title = `Waiting on ${view.waitingOn.join(", ")}`;
      children.push(start);
      // The host is the only one who needs to be told why Start is dead; everyone
      // else can read their own badge.
      this.hint.textContent = view.waitingOn.length > 0
        ? `Waiting on ${view.waitingOn.join(", ")}`
        : "Everyone is ready.";
    } else {
      this.hint.textContent = view.ready
        ? "Waiting for the host to start."
        : "Mark yourself ready when you like your loadout.";
      children.push(
        button(view.ready ? "Not ready" : "Ready", () => this.handlers.onReady(!view.ready),
          view.ready ? "" : "primary"),
      );
    }

    this.actions.replaceChildren(...children);
  }

  /** Show a server refusal under the roster. Survives re-renders — only another
   *  call (or leaving the lobby) clears it. */
  setError(text: string) {
    this.note.textContent = text;
  }

  destroy() {
    this.menu.destroy();
  }
}
