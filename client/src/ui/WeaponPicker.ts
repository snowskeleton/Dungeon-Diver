import { WEAPON_REGISTRY, WeaponId, WeaponCategory, Weapon } from "shared";
import { addStyle, button, el, menuPanel, selectOne, MenuPanel } from "./menuDom";

const CATEGORIES: WeaponCategory[] = ["sword", "axe", "spear", "rapier", "mace", "dagger", "hammer", "bow", "crossbow", "thrown", "staff"];
const CATEGORY_LABELS: Record<WeaponCategory, string> = {
  sword: "Swords", axe: "Axes", spear: "Spears", rapier: "Rapiers",
  mace: "Maces", dagger: "Daggers", hammer: "Hammers", bow: "Bows",
  crossbow: "Crossbows", thrown: "Thrown", staff: "Staves",
};

// The tab bar is this panel's own idea — no other menu pages its content — so it
// keeps its styling here. Everything else comes from menuDom.
const CSS = `
  .wp-tab { border-radius: 4px 4px 0 0; }
  .wp-tab.active { background: #4a4aaa; border-color: #8888ff; color: #fff; }
  #weapon-picker-grid { min-height: 108px; }
  .wp-icon span {
    font-size: 9px; color: #8888aa; text-align: center;
    max-width: 52px; word-break: break-word; line-height: 1.2;
  }
  /* Held ranged icons are 2-frame draw sheets (64×32) — show just the first
     (relaxed) frame, so the picker shows one bow rather than two. */
  .wp-held-crop { width: 48px; height: 48px; overflow: hidden; }
`;

export class WeaponPicker {
  private menu: MenuPanel | null = null;

  show(defaultWeaponId: WeaponId): Promise<WeaponId | null> {
    return new Promise((resolve) => {
      const finish = (id: WeaponId | null) => {
        this.hide();
        resolve(id);
      };
      const menu = menuPanel({ onEscape: () => finish(null) });
      this.menu = menu;
      addStyle("wp-style", CSS);

      // Group weapons by category
      const byCategory: Partial<Record<WeaponCategory, Weapon[]>> = {};
      for (const w of Object.values(WEAPON_REGISTRY)) {
        (byCategory[w.category] ??= []).push(w);
      }

      let activeCategory: WeaponCategory = WEAPON_REGISTRY[defaultWeaponId]?.category ?? "sword";
      let selectedId: WeaponId = defaultWeaponId;

      const tabBar = el("div", { className: "m-chips" });
      const grid = el("div", { className: "m-tiles" });
      grid.id = "weapon-picker-grid";

      const confirmBtn = button("Select", () => finish(selectedId), "primary");
      confirmBtn.disabled = !WEAPON_REGISTRY[selectedId];

      const renderGrid = () => {
        grid.replaceChildren(...(byCategory[activeCategory] ?? []).map((w) => {
          const tile = el("div", { className: `m-tile bare wp-icon${w.id === selectedId ? " selected" : ""}` }, [
            weaponIcon(w),
            el("span", { text: w.name }),
          ]);
          tile.title = `${w.name}\nDMG ${w.damage} · CD ${(w.attackCooldownMs / 1000).toFixed(1)}s`;
          tile.addEventListener("click", () => {
            selectedId = w.id as WeaponId;
            confirmBtn.disabled = false;
            selectOne(grid, tile);
          });
          return tile;
        }));
      };

      const renderTabs = () => {
        tabBar.replaceChildren(...CATEGORIES.filter((cat) => byCategory[cat]?.length).map((cat) =>
          el("button", {
            className: `m-chip wp-tab${cat === activeCategory ? " active" : ""}`,
            text: CATEGORY_LABELS[cat],
            onClick: () => {
              activeCategory = cat;
              // If current selection is in a different category, clear it
              if (WEAPON_REGISTRY[selectedId]?.category !== cat) {
                const first = byCategory[cat]?.[0];
                if (first) selectedId = first.id as WeaponId;
              }
              renderTabs();
              renderGrid();
            },
          }),
        ));
      };

      renderTabs();
      renderGrid();

      menu.panel.append(
        el("h2", { className: "m-title", text: "Choose a Weapon" }),
        tabBar,
        el("div", { className: "m-scroll" }, [grid]),
        el("div", { className: "m-actions end" }, [
          button("Cancel", () => finish(null)),
          confirmBtn,
        ]),
      );
    });
  }

  hide() {
    this.menu?.destroy();
    this.menu = null;
  }
}

function weaponIcon(w: Weapon): HTMLElement {
  const icon = el("img", { className: "m-icon" });
  icon.src = w.iconPath;
  if (w.rangedStyle !== "held") {
    icon.width = 48;
    icon.height = 48;
    return icon;
  }
  icon.width = 96;
  icon.height = 48;
  return el("div", { className: "wp-held-crop" }, [icon]);
}
