import { WeaponSlotView } from "shared";
import { weaponStatLines, viewFromSlot } from "./weaponStats";
import { addStyle, el, menuPanel, MenuPanel } from "./menuDom";

// The 1-of-3 reward picker (shrine boon / boss drop), modelled on InventoryMenu:
// a DOM overlay over the canvas, with the room paused server-side while it's open.
//
// Unlike the shop — browsable, reversible, unpaused — this is a single
// irreversible choice, so the world stops while you make it. The room is already
// cleared by the time a pedestal is reachable, so pausing costs nothing tactically;
// it just keeps a co-op partner from fighting while you read three cards.

/** The wire shape of one choice. Mirrors OfferChoiceState structurally so the
 *  client needs no server import (same rule as WeaponSlotView). */
export interface OfferChoiceView {
  kind: "weapon" | "upgrade";
  name: string;
  description: string;
  upgradeId: string;
  weapon: WeaponSlotView;
}

// The gold framing is the point: a reward pedestal should not look like the
// inventory screen. The panel wears menuDom's `gold` variant; what's left here
// is how that accent lands on a card.
const CSS = `
  .offer-card:hover { border-color: #ffe066; }
  .offer-kind {
    font-size: 9px; letter-spacing: 1px; color: #1a1a2e; background: #8888cc;
    padding: 1px 5px; border-radius: 3px; align-self: flex-start;
  }
  .offer-card.weapon .offer-kind { background: #ffe066; }
  .offer-desc { font-size: 11px; color: #ffe066; }
  .offer-icon { width: 40px; height: 40px; align-self: center; }
  .offer-card.taken { opacity: 0.35; cursor: not-allowed; filter: grayscale(1); }
  .offer-card.taken:hover { border-color: inherit; }
  .offer-taken-tag {
    font-size: 9px; letter-spacing: 1px; color: #ffb0b0; align-self: flex-start;
  }
`;

export class OfferPicker {
  private menu: MenuPanel | null = null;

  get isOpen(): boolean {
    return this.menu !== null;
  }

  /** Show the three cards. `onPick` receives the chosen index; the caller sends it
   *  to the server and unpauses. There is deliberately no cancel button — walking
   *  away isn't possible mid-pause, and the choice is free, so refusing it has no
   *  meaning. */
  show(
    choices: OfferChoiceView[],
    consumed: Set<number>,
    onPick: (index: number) => void,
  ) {
    if (this.menu) return;
    // Escape belongs to GameScene here, same as the inventory menu.
    const menu = menuPanel({
      variant: "auto gold center",
      zIndex: 1001,
    });
    this.menu = menu;
    addStyle("offer-style", CSS);

    const cards = el("div", { className: "m-cards" });
    choices.forEach((choice, i) => {
      // A card a teammate already took is dead — greyed and unclickable. The server
      // re-checks anyway, so this only saves a doomed round-trip.
      const taken = consumed.has(i);
      const card = el("div", {
        className: `m-card offer-card ${choice.kind}${taken ? " taken" : ""}`,
        onClick: taken ? undefined : () => {
          this.hide();
          onPick(i);
        },
      }, [
        el("span", {
          className: "offer-kind",
          text: choice.kind === "weapon" ? "WEAPON" : "UPGRADE",
        }),
      ]);
      card.append(...this.cardBody(choice));
      if (taken) card.appendChild(el("span", { className: "offer-taken-tag", text: "TAKEN" }));
      cards.appendChild(card);
    });

    menu.panel.append(
      el("h2", { className: "m-title", text: "CHOOSE YOUR REWARD" }),
      el("p", { className: "m-sub", text: "one only — the rest vanish" }),
      cards,
    );
  }

  private cardBody(choice: OfferChoiceView): HTMLElement[] {
    if (choice.kind !== "weapon") {
      return [
        el("div", { className: "m-row-name", text: choice.name }),
        el("div", { className: "m-row-detail", text: choice.description }),
      ];
    }
    const view = viewFromSlot(choice.weapon);
    const parts: HTMLElement[] = [];
    if (view) {
      const icon = el("img", { className: "m-icon offer-icon" });
      icon.src = view.iconPath;
      parts.push(icon);
    }
    parts.push(
      el("div", { className: "m-row-name", text: choice.name }),
      el("div", { className: "offer-desc", text: choice.description }),
    );
    if (view) {
      // The exact stats of the weapon that will be granted — the server keeps
      // the rolled modifiers, so this preview cannot drift from the reward.
      parts.push(el("div", {
        className: "m-row-detail",
        html: weaponStatLines(view).map((s) => `${s.label}: ${s.value}`).join("<br>"),
      }));
    }
    return parts;
  }

  hide() {
    this.menu?.destroy();
    this.menu = null;
  }
}
