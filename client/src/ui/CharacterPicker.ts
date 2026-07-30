import { CHARACTER_CLASSES, getCharacter, CharacterClass, CharacterType, PLAYER_SKINS, firstRollCategories } from "shared";
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

const CLASS_IDS: CharacterClass[] = CHARACTER_CLASSES;
// Every playable skin — the non-playable humanoid sheets (skeleton, skeleton-mage)
// live in HUMANOID_SKINS as enemies, not here, so no filter is needed.
const SKIN_IDS: CharacterType[] = [...PLAYER_SKINS];

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
        const character = getCharacter(id);
        const tile = el("div", { className: `m-tile grow${id === chosenClass ? " selected" : ""}` }, [
          el("div", { className: "m-tile-name", text: character.name }),
          el("div", {
            className: "m-tile-detail",
            // The class's UNIQUE weapon categories are its identity and its
            // first-weapon roll pool (the shared melee categories are omitted).
            text: `${character.maxHp} HP · ${character.speed} spd\n${firstRollCategories(id).join(", ")}`,
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
          text: "Class sets your stats and which weapons you can wield; skin is cosmetic.",
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
