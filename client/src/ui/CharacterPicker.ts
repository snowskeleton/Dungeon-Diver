import { CHARACTER_REGISTRY, CharacterClass, CharacterType, WEAPON_REGISTRY } from "shared";
import { CLIENT_CHARACTER_VISUAL_REGISTRY } from "../characters";
import { addStyle, button, el, menuPanel, selectOne } from "./menuDom";

export interface CharacterChoice {
  characterClass: CharacterClass;
  characterType: CharacterType;
}

// Humanoid sheets are 15 cols × 4 rows of 32px frames; row 2 col 0 is the
// front-facing idle pose. Scaled 2× for a 64px portrait.
const SHEET_COLS = 15;
const SHEET_ROWS = 4;
const FRAME = 32;
const SCALE = 2;
const PORTRAIT_ROW = 2;

// Everything else this panel needs — overlay, panel, tiles, buttons — is in
// menuDom. What is only true here is that a skin tile shows one frame cropped
// out of a walk sheet, which is a background-position trick and not a style.
const CSS = `
  .cp-skin { width: 62px; }
  .cp-skin span { font-size: 9px; color: #8888aa; }
  .cp-portrait {
    width: ${FRAME * SCALE}px; height: ${FRAME * SCALE}px;
    image-rendering: pixelated;
    background-size: ${SHEET_COLS * FRAME * SCALE}px ${SHEET_ROWS * FRAME * SCALE}px;
    background-position: 0 -${PORTRAIT_ROW * FRAME * SCALE}px;
  }
`;

const CLASS_IDS = Object.keys(CHARACTER_REGISTRY) as CharacterClass[];
const SKIN_IDS = Object.keys(CLIENT_CHARACTER_VISUAL_REGISTRY) as CharacterType[];

const skinLabel = (id: CharacterType) =>
  id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export class CharacterPicker {
  /** Resolves null if the player cancels. */
  show(playerLabel: string, initial: CharacterChoice): Promise<CharacterChoice | null> {
    return new Promise((resolve) => {
      let chosenClass = initial.characterClass;
      let chosenType = initial.characterType;

      const finish = (choice: CharacterChoice | null) => {
        menu.destroy();
        resolve(choice);
      };
      const menu = menuPanel({
        onEscape: () => finish(null),
        swallowKeys: true,
      });
      addStyle("cp-style", CSS);

      const classRow = el("div", { className: "m-tiles" });
      for (const id of CLASS_IDS) {
        const cfg = CHARACTER_REGISTRY[id];
        const tile = el("div", { className: `m-tile grow${id === chosenClass ? " selected" : ""}` }, [
          el("div", { className: "m-tile-name", text: cfg.name }),
          el("div", {
            className: "m-tile-detail",
            text: `${cfg.maxHp} HP · ${cfg.speed} spd\n${WEAPON_REGISTRY[cfg.defaultWeaponId].name}`,
          }),
        ]);
        tile.addEventListener("click", () => {
          chosenClass = id;
          selectOne(classRow, tile);
        });
        classRow.appendChild(tile);
      }

      const skinRow = el("div", { className: "m-tiles" });
      for (const id of SKIN_IDS) {
        const portrait = el("div", { className: "cp-portrait" });
        portrait.style.backgroundImage = `url(/sprites/${id}.png)`;
        const tile = el("div", { className: `m-tile bare cp-skin${id === chosenType ? " selected" : ""}` }, [
          portrait,
          el("span", { text: skinLabel(id) }),
        ]);
        tile.addEventListener("click", () => {
          chosenType = id;
          selectOne(skinRow, tile);
        });
        skinRow.appendChild(tile);
      }

      menu.panel.append(
        el("h2", { className: "m-title", text: `${playerLabel} — Choose a Character` }),
        el("p", {
          className: "m-sub",
          text: "Class sets your stats and starting weapon; skin is cosmetic.",
        }),
        el("h3", { className: "m-heading", text: "Class" }),
        classRow,
        el("h3", { className: "m-heading", text: "Skin" }),
        // Scrolls on its own: the skin list grows with every imported sheet, and
        // the panel's max-height would otherwise push the buttons off-screen.
        el("div", { className: "m-scroll" }, [skinRow]),
        el("div", { className: "m-actions end" }, [
          button("Cancel", () => finish(null)),
          button("Next", () => finish({ characterClass: chosenClass, characterType: chosenType }), "primary"),
        ]),
      );
    });
  }
}
