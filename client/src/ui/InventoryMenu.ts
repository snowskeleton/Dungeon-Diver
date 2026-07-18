import { WeaponSlotView, UpgradeSlotView } from "shared";
import { weaponStatLines, viewFromSlot } from "./weaponStats";

// Full-screen pause overlay (opened with the menu key — see LocalPlayer) listing
// the player's owned weapons with expanded stats, the active one highlighted.
// While it's open the room is paused server-side. Display only — switching is
// still done with the in-game hotkeys.
const CSS = `
  #inv-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.72);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; font-family: monospace;
  }
  #inv-modal {
    background: #1a1a2e; border: 2px solid #4a4a6a; border-radius: 8px;
    padding: 20px; min-width: 420px; max-width: 90vw; max-height: 86vh;
    overflow-y: auto; color: #e0e0ff;
  }
  #inv-modal h2 { margin: 0 0 14px; font-size: 16px; color: #aaaaff; letter-spacing: 1px; }
  .inv-row {
    display: flex; align-items: center; gap: 12px; padding: 8px;
    border: 1px solid #333355; border-radius: 6px; margin-bottom: 8px; background: #20203a;
  }
  .inv-row.active { border-color: #ffe066; background: #2a2a4a; }
  .inv-icon-box { width: 44px; height: 44px; overflow: hidden; flex: 0 0 44px; display: flex; align-items: center; justify-content: center; }
  .inv-icon-box img { image-rendering: pixelated; display: block; }
  .inv-info { flex: 1; }
  .inv-name { font-size: 13px; color: #fff; margin-bottom: 3px; }
  .inv-name .tag { font-size: 10px; color: #1a1a2e; background: #ffe066; padding: 1px 5px; border-radius: 3px; margin-left: 6px; }
  .inv-stats { font-size: 11px; color: #99aacc; }
  .inv-mods { font-size: 11px; color: #ffe066; margin-top: 2px; display: flex; gap: 8px; }
  .inv-stats span { display: inline-block; margin-right: 12px; }
  #inv-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
  #inv-hint { font-size: 11px; color: #7777aa; }
  .inv-btn {
    padding: 6px 16px; font-size: 12px; font-family: monospace; cursor: pointer;
    border-radius: 4px; border: 1px solid #8888ff; background: #4a4aaa; color: #fff;
  }
`;

export class InventoryMenu {
  private overlay: HTMLDivElement | null = null;

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  // Show the menu. `onClose` is called when the user closes it via the button so
  // the caller can also unpause.
  show(
    weapons: WeaponSlotView[],
    activeIndex: number,
    upgrades: UpgradeSlotView[],
    onClose: () => void,
  ) {
    if (this.overlay) return;
    if (!document.getElementById("inv-style")) {
      const style = document.createElement("style");
      style.id = "inv-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const overlay = document.createElement("div");
    overlay.id = "inv-overlay";
    this.overlay = overlay;

    const modal = document.createElement("div");
    modal.id = "inv-modal";
    overlay.appendChild(modal);

    const title = document.createElement("h2");
    title.textContent = "Inventory";
    modal.appendChild(title);

    weapons.forEach((slot, i) => {
      // Stats come off the synced slot, so a rolled weapon shows its real numbers
      // rather than its template's.
      const weapon = viewFromSlot(slot);
      if (!weapon) return;
      const row = document.createElement("div");
      row.className = "inv-row" + (i === activeIndex ? " active" : "");

      const iconBox = document.createElement("div");
      iconBox.className = "inv-icon-box";
      const icon = document.createElement("img");
      icon.src = weapon.iconPath;
      // Held ranged icons are 2-frame draw sheets (64×32) — crop to the first frame.
      if (weapon.rangedStyle === "held") {
        icon.width = 88; icon.height = 44;
        iconBox.style.justifyContent = "flex-start";
      } else {
        icon.width = 44; icon.height = 44;
      }
      iconBox.appendChild(icon);
      row.appendChild(iconBox);

      const info = document.createElement("div");
      info.className = "inv-info";
      const name = document.createElement("div");
      name.className = "inv-name";
      name.innerHTML = weapon.name + (i === activeIndex ? ' <span class="tag">EQUIPPED</span>' : "");
      const stats = document.createElement("div");
      stats.className = "inv-stats";
      stats.innerHTML = weaponStatLines(weapon).map((s) => `<span>${s.label}: ${s.value}</span>`).join("");
      info.appendChild(name);
      info.appendChild(stats);
      const modLabels = Array.from(slot.modLabels);
      if (modLabels.length) {
        const mods = document.createElement("div");
        mods.className = "inv-mods";
        mods.innerHTML = modLabels.map((m) => `<span>${m}</span>`).join("");
        info.appendChild(mods);
      }
      row.appendChild(info);

      modal.appendChild(row);
    });

    if (upgrades.length) {
      const heading = document.createElement("h2");
      heading.textContent = "Upgrades";
      modal.appendChild(heading);
      for (const u of upgrades) {
        const row = document.createElement("div");
        row.className = "inv-row";
        const info = document.createElement("div");
        info.className = "inv-info";
        const name = document.createElement("div");
        name.className = "inv-name";
        name.textContent = u.name;
        const desc = document.createElement("div");
        desc.className = "inv-stats";
        desc.innerHTML = `<span>${u.description}</span>`;
        info.appendChild(name);
        info.appendChild(desc);
        row.appendChild(info);
        modal.appendChild(row);
      }
    }

    const footer = document.createElement("div");
    footer.id = "inv-footer";
    const hint = document.createElement("div");
    hint.id = "inv-hint";
    hint.textContent = "Q/E to switch weapon · game is paused";
    const closeBtn = document.createElement("button");
    closeBtn.className = "inv-btn";
    closeBtn.textContent = "Resume";
    closeBtn.addEventListener("click", () => {
      this.hide();
      onClose();
    });
    footer.appendChild(hint);
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    document.body.appendChild(overlay);
  }

  hide() {
    this.overlay?.remove();
    this.overlay = null;
  }
}
