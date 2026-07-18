import { WeaponSlotView, UpgradeSlotView } from "shared";
import { weaponStatLines, viewFromSlot } from "./weaponStats";

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

const CSS = `
  #offer-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.78);
    display: flex; align-items: center; justify-content: center;
    z-index: 1001; font-family: monospace;
  }
  #offer-modal {
    background: #1a1a2e; border: 2px solid #ffe066; border-radius: 8px;
    padding: 22px; max-width: 92vw; color: #e0e0ff; text-align: center;
  }
  #offer-modal h2 { margin: 0 0 4px; font-size: 17px; color: #ffe066; letter-spacing: 2px; }
  #offer-sub { font-size: 11px; color: #7777aa; margin-bottom: 16px; }
  #offer-cards { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .offer-card {
    width: 190px; padding: 12px; border: 1px solid #4a4a6a; border-radius: 6px;
    background: #20203a; cursor: pointer; text-align: left;
    display: flex; flex-direction: column; gap: 6px;
  }
  .offer-card:hover { border-color: #ffe066; background: #2a2a4a; }
  .offer-kind { font-size: 9px; letter-spacing: 1px; color: #1a1a2e; background: #8888cc;
    padding: 1px 5px; border-radius: 3px; align-self: flex-start; }
  .offer-card.weapon .offer-kind { background: #ffe066; }
  .offer-name { font-size: 13px; color: #fff; }
  .offer-desc { font-size: 11px; color: #ffe066; }
  .offer-stats { font-size: 10px; color: #99aacc; line-height: 1.5; }
  .offer-icon { width: 40px; height: 40px; image-rendering: pixelated; align-self: center; }
`;

export class OfferPicker {
  private overlay: HTMLDivElement | null = null;

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  /** Show the three cards. `onPick` receives the chosen index; the caller sends it
   *  to the server and unpauses. There is deliberately no cancel button — walking
   *  away isn't possible mid-pause, and the choice is free, so refusing it has no
   *  meaning. */
  show(choices: OfferChoiceView[], onPick: (index: number) => void) {
    if (this.overlay) return;
    if (!document.getElementById("offer-style")) {
      const style = document.createElement("style");
      style.id = "offer-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const overlay = document.createElement("div");
    overlay.id = "offer-overlay";
    this.overlay = overlay;

    const modal = document.createElement("div");
    modal.id = "offer-modal";
    overlay.appendChild(modal);

    const title = document.createElement("h2");
    title.textContent = "CHOOSE YOUR REWARD";
    modal.appendChild(title);

    const sub = document.createElement("div");
    sub.id = "offer-sub";
    sub.textContent = "one only — the rest vanish";
    modal.appendChild(sub);

    const cards = document.createElement("div");
    cards.id = "offer-cards";
    modal.appendChild(cards);

    choices.forEach((choice, i) => {
      const card = document.createElement("div");
      card.className = `offer-card ${choice.kind}`;

      const kind = document.createElement("span");
      kind.className = "offer-kind";
      kind.textContent = choice.kind === "weapon" ? "WEAPON" : "UPGRADE";
      card.appendChild(kind);

      if (choice.kind === "weapon") {
        const view = viewFromSlot(choice.weapon);
        if (view) {
          const icon = document.createElement("img");
          icon.className = "offer-icon";
          icon.src = view.iconPath;
          card.appendChild(icon);
        }
        const name = document.createElement("div");
        name.className = "offer-name";
        name.textContent = choice.name;
        card.appendChild(name);
        const desc = document.createElement("div");
        desc.className = "offer-desc";
        desc.textContent = choice.description;
        card.appendChild(desc);
        if (view) {
          const stats = document.createElement("div");
          stats.className = "offer-stats";
          // The exact stats of the weapon that will be granted — the server keeps
          // the rolled modifiers, so this preview cannot drift from the reward.
          stats.innerHTML = weaponStatLines(view)
            .map((s) => `${s.label}: ${s.value}`)
            .join("<br>");
          card.appendChild(stats);
        }
      } else {
        const name = document.createElement("div");
        name.className = "offer-name";
        name.textContent = choice.name;
        card.appendChild(name);
        const desc = document.createElement("div");
        desc.className = "offer-stats";
        desc.textContent = choice.description;
        card.appendChild(desc);
      }

      card.onclick = () => { this.hide(); onPick(i); };
      cards.appendChild(card);
    });

    document.body.appendChild(overlay);
  }

  hide() {
    this.overlay?.remove();
    this.overlay = null;
  }
}
