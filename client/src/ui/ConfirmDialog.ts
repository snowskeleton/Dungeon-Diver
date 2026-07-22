// A yes/no DOM overlay, on menuDom's shared look with a red frame.
//
// Exists because abandoning a run is irreversible and there is no save: Escape
// used to drop straight to the menu and nuked a live co-op session mid-playtest
// (B3). The plan was for D7's pause menu to delete this file — but a labelled
// "Abandon run" entry in a menu and a confirmed one are not the same promise to
// the other three people in the party, so it survives as the last step of that
// entry rather than as the meaning of a keypress.

import { addStyle, button, el, menuPanel } from "./menuDom";

// The red framing is the whole point of this dialog and belongs to nothing else:
// it is the one overlay that asks you to destroy something.
const CSS = `
  .confirm-panel { border-color: #ff6b6b; }
  .confirm-panel .m-title { color: #ff6b6b; }
  .confirm-body { font-size: 12px; color: #99aacc; line-height: 1.6; }
`;

/**
 * Show a modal and resolve true only if the user actively confirms. Escape and
 * the cancel button both resolve false, so the safe answer is the reflexive one.
 */
export function confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    // One exit path for both answers, so the listener and the DOM are always torn
    // down exactly once no matter how the dialog is dismissed.
    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onEnter, true);
      menu.destroy();
      resolve(answer);
    };

    // Enter accepts; Escape is menuPanel's, and it means "no". Captured on the
    // window because the canvas has focus during gameplay.
    const onEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.stopPropagation();
      finish(true);
    };
    window.addEventListener("keydown", onEnter, true);

    const menu = menuPanel({
      variant: "narrow center confirm-panel",
      onEscape: () => finish(false),
      zIndex: 1002,
    });
    addStyle("confirm-style", CSS);

    const cancel = button("Keep playing", () => finish(false));
    menu.panel.append(
      el("h2", { className: "m-title", text: title }),
      el("div", { className: "confirm-body", text: body }),
      el("div", { className: "m-actions center" }, [
        cancel,
        button(confirmLabel, () => finish(true), "danger"),
      ]),
    );
    cancel.focus();
  });
}
