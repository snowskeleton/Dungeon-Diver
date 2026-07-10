import { WEAPON_REGISTRY, WeaponId, WeaponCategory, Weapon } from "shared";

const CATEGORIES: WeaponCategory[] = ["sword", "axe", "spear", "rapier", "mace", "dagger", "hammer", "bow", "crossbow", "thrown", "staff"];
const CATEGORY_LABELS: Record<WeaponCategory, string> = {
  sword: "Swords", axe: "Axes", spear: "Spears", rapier: "Rapiers",
  mace: "Maces", dagger: "Daggers", hammer: "Hammers", bow: "Bows",
  crossbow: "Crossbows", thrown: "Thrown", staff: "Staves",
};

const CSS = `
  #weapon-picker-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; font-family: monospace;
  }
  #weapon-picker-modal {
    background: #1a1a2e; border: 2px solid #4a4a6a; border-radius: 8px;
    padding: 20px; min-width: 460px; max-width: 90vw; color: #e0e0ff;
  }
  #weapon-picker-modal h2 { margin: 0 0 14px; font-size: 16px; color: #aaaaff; letter-spacing: 1px; }
  #weapon-picker-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
  .wp-tab {
    padding: 4px 10px; font-size: 11px; font-family: monospace; cursor: pointer;
    background: #2a2a4a; border: 1px solid #4a4a6a; border-radius: 4px; color: #aaaacc;
  }
  .wp-tab.active { background: #4a4aaa; border-color: #8888ff; color: #fff; }
  #weapon-picker-grid { display: flex; flex-wrap: wrap; gap: 6px; min-height: 108px; }
  .wp-icon {
    cursor: pointer; border: 2px solid transparent; border-radius: 4px;
    padding: 2px; transition: border-color 0.1s;
    display: flex; flex-direction: column; align-items: center;
  }
  .wp-icon:hover { border-color: #6666bb; }
  .wp-icon.selected { border-color: #8888ff; background: #2a2a5a; }
  .wp-icon span {
    font-size: 9px; color: #8888aa; margin-top: 2px; text-align: center;
    max-width: 52px; word-break: break-word; line-height: 1.2;
  }
  #weapon-picker-footer { display: flex; justify-content: flex-end; margin-top: 14px; gap: 8px; }
  .wp-btn {
    padding: 6px 16px; font-size: 12px; font-family: monospace; cursor: pointer;
    border-radius: 4px; border: 1px solid #4a4a6a;
  }
  .wp-btn-confirm { background: #4a4aaa; color: #fff; border-color: #8888ff; }
  .wp-btn-confirm:disabled { opacity: 0.4; cursor: default; }
  .wp-btn-cancel { background: #2a2a4a; color: #aaaacc; }
`;

export class WeaponPicker {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;

  show(defaultWeaponId: WeaponId): Promise<WeaponId | null> {
    return new Promise((resolve) => {
      // Inject CSS once
      if (!document.getElementById("wp-style")) {
        this.styleEl = document.createElement("style");
        this.styleEl.id = "wp-style";
        this.styleEl.textContent = CSS;
        document.head.appendChild(this.styleEl);
      }

      const overlay = document.createElement("div");
      overlay.id = "weapon-picker-overlay";
      document.body.appendChild(overlay);
      this.overlay = overlay;

      const modal = document.createElement("div");
      modal.id = "weapon-picker-modal";
      overlay.appendChild(modal);

      const title = document.createElement("h2");
      title.textContent = "Choose a Weapon";
      modal.appendChild(title);

      // Group weapons by category
      const byCategory: Partial<Record<WeaponCategory, Weapon[]>> = {};
      for (const w of Object.values(WEAPON_REGISTRY)) {
        (byCategory[w.category] ??= []).push(w);
      }

      let activeCategory: WeaponCategory = (() => {
        const def = WEAPON_REGISTRY[defaultWeaponId];
        return def?.category ?? "sword";
      })();
      let selectedId: WeaponId = defaultWeaponId;

      // Tabs
      const tabBar = document.createElement("div");
      tabBar.id = "weapon-picker-tabs";
      modal.appendChild(tabBar);

      // Grid
      const grid = document.createElement("div");
      grid.id = "weapon-picker-grid";
      modal.appendChild(grid);

      // Confirm button (need ref before renderGrid)
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "wp-btn wp-btn-confirm";
      confirmBtn.textContent = "Select";

      const renderGrid = () => {
        grid.innerHTML = "";
        const weapons = byCategory[activeCategory] ?? [];
        for (const w of weapons) {
          const cell = document.createElement("div");
          cell.className = "wp-icon" + (w.id === selectedId ? " selected" : "");
          cell.title = `${w.name}\nDMG ${w.damage} · CD ${(w.attackCooldownMs/1000).toFixed(1)}s`;

          if (w.rangedStyle === "held") {
            // Held ranged weapons (bows/crossbows) use 2-frame draw sheets (64×32)
            // — crop to just the first (relaxed) frame so the picker shows one bow.
            const box = document.createElement("div");
            box.style.cssText = "width: 48px; height: 48px; overflow: hidden;";
            const icon = document.createElement("img");
            icon.src = w.iconPath;
            icon.width = 96;
            icon.height = 48;
            icon.style.cssText = "image-rendering: pixelated; display: block;";
            box.appendChild(icon);
            cell.appendChild(box);
          } else {
            const icon = document.createElement("img");
            icon.src = w.iconPath;
            icon.width = 48;
            icon.height = 48;
            icon.style.cssText = "image-rendering: pixelated; display: block;";
            cell.appendChild(icon);
          }

          const label = document.createElement("span");
          label.textContent = w.name;
          cell.appendChild(label);

          cell.addEventListener("click", () => {
            selectedId = w.id as WeaponId;
            confirmBtn.disabled = false;
            grid.querySelectorAll(".wp-icon").forEach(el => el.classList.remove("selected"));
            cell.classList.add("selected");
          });

          grid.appendChild(cell);
        }
      };

      const renderTabs = () => {
        tabBar.innerHTML = "";
        for (const cat of CATEGORIES) {
          if (!byCategory[cat]?.length) continue;
          const tab = document.createElement("button");
          tab.className = "wp-tab" + (cat === activeCategory ? " active" : "");
          tab.textContent = CATEGORY_LABELS[cat];
          tab.addEventListener("click", () => {
            activeCategory = cat;
            // If current selection is in a different category, clear it
            const curWeapon = WEAPON_REGISTRY[selectedId];
            if (curWeapon?.category !== cat) {
              const first = byCategory[cat]?.[0];
              if (first) selectedId = first.id as WeaponId;
            }
            renderTabs();
            renderGrid();
          });
          tabBar.appendChild(tab);
        }
      };

      renderTabs();
      renderGrid();

      // Footer
      const footer = document.createElement("div");
      footer.id = "weapon-picker-footer";
      modal.appendChild(footer);

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "wp-btn wp-btn-cancel";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        this.hide();
        resolve(null);
      });

      confirmBtn.disabled = !WEAPON_REGISTRY[selectedId];
      confirmBtn.addEventListener("click", () => {
        this.hide();
        resolve(selectedId);
      });

      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);
    });
  }

  hide() {
    this.overlay?.remove();
    this.overlay = null;
  }
}
