import { CHARACTER_REGISTRY, CharacterClass, CharacterType, WEAPON_REGISTRY } from "shared";
import { CLIENT_CHARACTER_VISUAL_REGISTRY } from "../characters";

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

const CSS = `
  #char-picker-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.78);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; font-family: monospace;
  }
  #char-picker-modal {
    background: #1a1a2e; border: 2px solid #4a4a6a; border-radius: 8px;
    padding: 20px; width: 520px; max-width: 92vw; color: #e0e0ff;
  }
  #char-picker-modal h2 { margin: 0 0 4px; font-size: 16px; color: #aaaaff; letter-spacing: 1px; }
  #char-picker-modal h3 { margin: 16px 0 8px; font-size: 11px; color: #777799; letter-spacing: 1px; text-transform: uppercase; }
  .cp-sub { margin: 0; font-size: 11px; color: #777799; }
  .cp-classes { display: flex; gap: 8px; }
  .cp-class {
    flex: 1; cursor: pointer; padding: 8px; text-align: center;
    background: #2a2a4a; border: 2px solid #4a4a6a; border-radius: 6px; color: #ccccee;
  }
  .cp-class:hover { border-color: #6666bb; }
  .cp-class.selected { border-color: #8888ff; background: #33335e; color: #fff; }
  .cp-class-name { font-size: 12px; font-weight: bold; }
  .cp-class-stats { font-size: 10px; color: #8888aa; margin-top: 4px; line-height: 1.4; }
  .cp-skins { display: flex; flex-wrap: wrap; gap: 10px; }
  .cp-skin {
    cursor: pointer; padding: 6px; border: 2px solid transparent; border-radius: 6px;
    display: flex; flex-direction: column; align-items: center;
    width: 62px;
  }
  .cp-skin:hover { border-color: #6666bb; }
  .cp-skin.selected { border-color: #8888ff; background: #2a2a5a; }
  .cp-skin span { font-size: 9px; color: #8888aa; margin-top: 4px; }
  .cp-portrait {
    width: ${FRAME * SCALE}px; height: ${FRAME * SCALE}px;
    image-rendering: pixelated;
    background-size: ${SHEET_COLS * FRAME * SCALE}px ${SHEET_ROWS * FRAME * SCALE}px;
    background-position: 0 -${PORTRAIT_ROW * FRAME * SCALE}px;
  }
  #char-picker-footer { display: flex; justify-content: flex-end; margin-top: 18px; gap: 8px; }
  .cp-btn {
    padding: 6px 16px; font-size: 12px; font-family: monospace; cursor: pointer;
    border-radius: 4px; border: 1px solid #4a4a6a; background: #2a2a4a; color: #aaaacc;
  }
  .cp-btn.primary { background: #4a4aaa; color: #fff; border-color: #8888ff; }
`;

const CLASS_IDS = Object.keys(CHARACTER_REGISTRY) as CharacterClass[];
const SKIN_IDS = Object.keys(CLIENT_CHARACTER_VISUAL_REGISTRY) as CharacterType[];

const skinLabel = (id: CharacterType) =>
  id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export class CharacterPicker {
  /** Resolves null if the player cancels. */
  show(playerLabel: string, initial: CharacterChoice): Promise<CharacterChoice | null> {
    if (!document.getElementById("cp-style")) {
      const style = document.createElement("style");
      style.id = "cp-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    return new Promise((resolve) => {
      let chosenClass = initial.characterClass;
      let chosenType = initial.characterType;

      const overlay = document.createElement("div");
      overlay.id = "char-picker-overlay";
      document.body.appendChild(overlay);

      const modal = document.createElement("div");
      modal.id = "char-picker-modal";
      overlay.appendChild(modal);

      const finish = (choice: CharacterChoice | null) => {
        overlay.remove();
        window.removeEventListener("keydown", onKey);
        resolve(choice);
      };
      const onKey = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(null);
      };
      window.addEventListener("keydown", onKey);

      const title = document.createElement("h2");
      title.textContent = `${playerLabel} — Choose a Character`;
      modal.appendChild(title);

      const sub = document.createElement("p");
      sub.className = "cp-sub";
      sub.textContent = "Class sets your stats and starting weapon; skin is cosmetic.";
      modal.appendChild(sub);

      const classHeading = document.createElement("h3");
      classHeading.textContent = "Class";
      modal.appendChild(classHeading);

      const classRow = document.createElement("div");
      classRow.className = "cp-classes";
      modal.appendChild(classRow);

      for (const id of CLASS_IDS) {
        const cfg = CHARACTER_REGISTRY[id];
        const cell = document.createElement("div");
        cell.className = "cp-class" + (id === chosenClass ? " selected" : "");

        const name = document.createElement("div");
        name.className = "cp-class-name";
        name.textContent = cfg.name;
        cell.appendChild(name);

        const stats = document.createElement("div");
        stats.className = "cp-class-stats";
        stats.textContent = `${cfg.maxHp} HP · ${cfg.speed} spd\n${WEAPON_REGISTRY[cfg.defaultWeaponId].name}`;
        stats.style.whiteSpace = "pre-line";
        cell.appendChild(stats);

        cell.addEventListener("click", () => {
          chosenClass = id;
          classRow.querySelectorAll(".cp-class").forEach((el) => el.classList.remove("selected"));
          cell.classList.add("selected");
        });
        classRow.appendChild(cell);
      }

      const skinHeading = document.createElement("h3");
      skinHeading.textContent = "Skin";
      modal.appendChild(skinHeading);

      const skinRow = document.createElement("div");
      skinRow.className = "cp-skins";
      modal.appendChild(skinRow);

      for (const id of SKIN_IDS) {
        const cell = document.createElement("div");
        cell.className = "cp-skin" + (id === chosenType ? " selected" : "");

        const portrait = document.createElement("div");
        portrait.className = "cp-portrait";
        portrait.style.backgroundImage = `url(/sprites/${id}.png)`;
        cell.appendChild(portrait);

        const label = document.createElement("span");
        label.textContent = skinLabel(id);
        cell.appendChild(label);

        cell.addEventListener("click", () => {
          chosenType = id;
          skinRow.querySelectorAll(".cp-skin").forEach((el) => el.classList.remove("selected"));
          cell.classList.add("selected");
        });
        skinRow.appendChild(cell);
      }

      const footer = document.createElement("div");
      footer.id = "char-picker-footer";
      modal.appendChild(footer);

      const cancel = document.createElement("button");
      cancel.className = "cp-btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => finish(null));
      footer.appendChild(cancel);

      const confirm = document.createElement("button");
      confirm.className = "cp-btn primary";
      confirm.textContent = "Next";
      confirm.addEventListener("click", () =>
        finish({ characterClass: chosenClass, characterType: chosenType }),
      );
      footer.appendChild(confirm);
    });
  }
}
