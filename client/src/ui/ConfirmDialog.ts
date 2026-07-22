// A yes/no DOM overlay, styled like InventoryMenu/OfferPicker.
//
// Exists because abandoning a run is irreversible and there is no save: Escape
// used to drop straight to the menu and nuked a live co-op session mid-playtest
// (B3). This is deliberately the smallest thing that makes quitting a decision
// rather than an accident — the real resumable pause menu (decision D7) replaces
// it wholesale, and this file should go away with it.

const CSS = `
  #confirm-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.78);
    display: flex; align-items: center; justify-content: center;
    z-index: 1002; font-family: monospace;
  }
  #confirm-modal {
    background: #1a1a2e; border: 2px solid #ff6b6b; border-radius: 8px;
    padding: 22px 26px; color: #e0e0ff; text-align: center; max-width: 90vw;
  }
  #confirm-modal h2 { margin: 0 0 6px; font-size: 16px; color: #ff6b6b; letter-spacing: 2px; }
  #confirm-body { font-size: 12px; color: #99aacc; margin-bottom: 18px; line-height: 1.6; }
  #confirm-buttons { display: flex; gap: 12px; justify-content: center; }
  .confirm-btn {
    font-family: monospace; font-size: 12px; padding: 8px 18px; border-radius: 5px;
    cursor: pointer; border: 1px solid #4a4a6a; background: #20203a; color: #e0e0ff;
  }
  .confirm-btn:hover { border-color: #8888cc; background: #2a2a4a; }
  .confirm-btn.danger { border-color: #ff6b6b; color: #ff6b6b; }
  .confirm-btn.danger:hover { background: #3a2030; }
`;

/**
 * Show a modal and resolve true only if the user actively confirms. Escape and
 * the cancel button both resolve false, so the safe answer is the reflexive one.
 */
export function confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const style = document.createElement("style");
    style.textContent = CSS;

    const overlay = document.createElement("div");
    overlay.id = "confirm-overlay";
    overlay.innerHTML = `
      <div id="confirm-modal">
        <h2>${title}</h2>
        <div id="confirm-body">${body}</div>
        <div id="confirm-buttons"></div>
      </div>
    `;

    // One exit path for both answers, so the listener and the DOM are always torn
    // down exactly once no matter how the dialog is dismissed.
    let done = false;
    const finish = (answer: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      style.remove();
      resolve(answer);
    };

    // Captured on the window: the canvas has focus during gameplay, and this must
    // beat Phaser's own Escape handler to the event.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        finish(true);
      }
    };
    window.addEventListener("keydown", onKey, true);

    const buttons = overlay.querySelector("#confirm-buttons")!;

    const cancel = document.createElement("button");
    cancel.className = "confirm-btn";
    cancel.textContent = "Keep playing";
    cancel.onclick = () => finish(false);

    const accept = document.createElement("button");
    accept.className = "confirm-btn danger";
    accept.textContent = confirmLabel;
    accept.onclick = () => finish(true);

    buttons.appendChild(cancel);
    buttons.appendChild(accept);
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    cancel.focus();
  });
}
