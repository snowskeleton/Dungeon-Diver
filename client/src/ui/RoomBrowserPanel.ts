import { RoomListing, ROOM_CODE_LENGTH, MAX_ROOM_NAME_LEN, isRoomCode } from "shared";
import { el, button, menuPanel, MenuPanel } from "./menuDom";

export interface BrowserHandlers {
  onJoin(roomId: string): void;
  onJoinByCode(code: string): void;
  onHost(roomName: string, isPrivate: boolean): void;
  onRefresh(): void;
  onBack(): void;
}

/**
 * The "who else is playing" screen: every public room that hasn't started, a box
 * for a private room's code, and the controls to open one of your own.
 *
 * Only public, unstarted rooms can appear here — that isn't a filter this panel
 * applies, it's what the server's listing contains (private rooms are unlisted;
 * a started run is locked). So an empty list genuinely means nobody is waiting,
 * and it says so rather than looking broken.
 */
export class RoomBrowserPanel {
  private readonly menu: MenuPanel;
  private readonly handlers: BrowserHandlers;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly privateBox: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;

  constructor(handlers: BrowserHandlers, defaultRoomName: string) {
    this.handlers = handlers;
    this.menu = menuPanel({ onEscape: () => handlers.onBack() });

    this.list = el("div", { className: "m-scroll" });
    this.note = el("div", { className: "m-note" });

    this.codeInput = el("input", { className: "m-input code" });
    this.codeInput.maxLength = ROOM_CODE_LENGTH;
    this.codeInput.placeholder = "CODE";
    this.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submitCode();
      e.stopPropagation();
    });

    this.nameInput = el("input", { className: "m-input m-grow" });
    this.nameInput.maxLength = MAX_ROOM_NAME_LEN;
    this.nameInput.value = defaultRoomName;
    this.nameInput.addEventListener("keydown", (e) => e.stopPropagation());

    this.privateBox = el("input");
    this.privateBox.type = "checkbox";

    this.menu.panel.append(
      el("h2", { className: "m-title", text: "Play Online" }),
      el("p", {
        className: "m-sub",
        text: "Rooms only accept players from their lobby — nobody drops into a run in progress.",
      }),
      el("div", { className: "m-actions" }, [
        el("h3", { className: "m-heading m-grow", text: "Open rooms" }),
        this.smallButton("Refresh", () => handlers.onRefresh()),
      ]),
      this.list,
      el("h3", { className: "m-heading", text: "Join by code" }),
      el("div", { className: "m-actions" }, [
        this.codeInput,
        button("Join", () => this.submitCode()),
      ]),
      el("h3", { className: "m-heading", text: "Host a room" }),
      el("div", { className: "m-actions" }, [
        this.nameInput,
        el("label", { className: "m-checkbox" }, [
          this.privateBox,
          el("span", { text: "Private" }),
        ]),
        button("Create", () => this.handlers.onHost(this.nameInput.value, this.privateBox.checked), "primary"),
      ]),
      this.note,
      el("div", { className: "m-actions" }, [button("Back", () => handlers.onBack())]),
    );
  }

  private smallButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = button(label, onClick);
    btn.classList.add("small");
    return btn;
  }

  private submitCode() {
    const code = this.codeInput.value.trim().toUpperCase();
    if (!isRoomCode(code)) {
      this.setNote(`A join code is ${ROOM_CODE_LENGTH} characters.`);
      return;
    }
    this.handlers.onJoinByCode(code);
  }

  renderRooms(rooms: RoomListing[]) {
    if (rooms.length === 0) {
      this.list.replaceChildren(
        el("div", { className: "m-empty", text: "No open rooms. Host one and share the code." }),
      );
      return;
    }
    this.list.replaceChildren(...rooms.map((room) => {
      const full = room.clients >= room.maxClients;
      const row = el("div", { className: `m-row${full ? "" : " clickable"}` }, [
        el("div", { className: "m-grow" }, [
          el("div", { className: "m-row-name", text: room.metadata.roomName }),
          el("div", { className: "m-row-detail", text: `host: ${room.metadata.hostName}` }),
        ]),
        el("span", { className: "m-badge", text: `${room.clients}/${room.maxClients}` }),
      ]);
      if (!full) row.addEventListener("click", () => this.handlers.onJoin(room.roomId));
      return row;
    }));
  }

  setNote(text: string) {
    this.note.textContent = text;
  }

  setBusy(busy: boolean) {
    this.menu.panel.querySelectorAll("button").forEach((btn) => { btn.disabled = busy; });
  }

  destroy() {
    this.menu.destroy();
  }
}
