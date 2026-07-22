import { WeaponSlotView, UpgradeSlotView } from "shared";
import { weaponStatLines, viewFromSlot } from "./weaponStats";
import { addStyle, button, el, menuPanel, MenuPanel } from "./menuDom";

// Full-screen pause overlay (opened with the menu key — see LocalPlayer) listing
// the player's owned weapons with expanded stats, the active one highlighted.
// While it's open the room is paused server-side. Display only — switching is
// still done with the in-game hotkeys.

// Only the rolled-modifier line is particular to this panel: it is gold because
// it is the part of a weapon that isn't on its template.
const CSS = `
  .inv-mods { font-size: 11px; color: #ffe066; margin-top: 3px; display: flex; gap: 8px; }
`;

export class InventoryMenu {
  private menu: MenuPanel | null = null;

  get isOpen(): boolean {
    return this.menu !== null;
  }

  // Show the menu. `onClose` is called when the user closes it via the button so
  // the caller can also unpause.
  show(
    weapons: WeaponSlotView[],
    activeIndex: number,
    upgrades: UpgradeSlotView[],
    onClose: () => void,
  ) {
    if (this.menu) return;
    const close = () => {
      this.hide();
      onClose();
    };
    // No `onEscape`: Escape over the world is GameScene's, which peels overlays
    // in a defined order (offer picker, then this) and unpauses through the
    // player's own connection. A second handler here would race that.
    const menu = menuPanel({});
    this.menu = menu;
    addStyle("inv-style", CSS);

    const body = el("div", { className: "m-scroll" });

    weapons.forEach((slot, i) => {
      // Stats come off the synced slot, so a rolled weapon shows its real numbers
      // rather than its template's.
      const weapon = viewFromSlot(slot);
      if (!weapon) return;

      const icon = el("img");
      icon.src = weapon.iconPath;
      const iconBox = el("div", { className: "m-icon-box" }, [icon]);
      // Held ranged icons are 2-frame draw sheets (64×32) — crop to the first frame.
      if (weapon.rangedStyle === "held") {
        icon.width = 88;
        icon.height = 44;
        iconBox.style.justifyContent = "flex-start";
      } else {
        icon.width = 44;
        icon.height = 44;
      }

      const info = el("div", { className: "m-grow" }, [
        el("div", { className: "m-row-name" }, [
          el("span", { text: weapon.name }),
          ...(i === activeIndex ? [el("span", { className: "m-badge gold", text: "EQUIPPED" })] : []),
        ]),
        el("div", {
          className: "m-row-detail",
          html: weaponStatLines(weapon).map((s) => `<span>${s.label}: ${s.value}</span>`).join(""),
        }),
      ]);

      const modLabels = Array.from(slot.modLabels);
      if (modLabels.length) {
        info.appendChild(el("div", {
          className: "inv-mods",
          html: modLabels.map((m) => `<span>${m}</span>`).join(""),
        }));
      }

      body.appendChild(el("div", { className: `m-row${i === activeIndex ? " active" : ""}` }, [iconBox, info]));
    });

    if (upgrades.length) {
      body.appendChild(el("h3", { className: "m-heading", text: "Upgrades" }));
      for (const u of upgrades) {
        body.appendChild(el("div", { className: "m-row" }, [
          el("div", { className: "m-grow" }, [
            el("div", { className: "m-row-name", text: u.name }),
            el("div", { className: "m-row-detail", text: u.description }),
          ]),
        ]));
      }
    }

    menu.panel.append(
      el("h2", { className: "m-title", text: "Inventory" }),
      body,
      el("div", { className: "m-actions" }, [
        el("div", { className: "m-hint m-grow", text: "Q/E to switch weapon · game is paused" }),
        button("Resume", close, "primary"),
      ]),
    );
  }

  hide() {
    this.menu?.destroy();
    this.menu = null;
  }
}
