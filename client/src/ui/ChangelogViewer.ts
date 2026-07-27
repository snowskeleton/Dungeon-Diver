import { CHANGELOG, KIND_LABELS, type ChangeKind } from "shared";
import { addStyle, el, button, menuPanel } from "./menuDom";

// The in-game changelog. Renders straight from shared/src/changelog.ts (the one
// source of truth) — every released version plus the working one, newest first.
// Opened from the Options panel; a plain scrolling read-only overlay.

const KIND_ORDER: ChangeKind[] = ["feature", "fix", "balance", "ui"];

const CSS = `
  .m-log-ver { display: flex; flex-direction: column; gap: 8px; }
  .m-log-ver + .m-log-ver { margin-top: 6px; padding-top: 14px; border-top: 1px solid #333355; }
  .m-log-head { display: flex; align-items: baseline; gap: 10px; }
  .m-log-ver-name { font-size: 15px; color: #f6e05e; letter-spacing: 1px; }
  .m-log-date { font-size: 11px; color: #777799; }
  .m-log-group { display: flex; gap: 8px; align-items: flex-start; }
  .m-log-kind {
    flex: 0 0 62px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
    color: #99aacc; padding-top: 2px;
  }
  .m-log-kind.fix { color: #48bb78; }
  .m-log-kind.balance { color: #f6ad55; }
  .m-log-kind.feature { color: #63b3ed; }
  .m-log-kind.ui { color: #b794f4; }
  .m-log-lines { flex: 1; display: flex; flex-direction: column; gap: 5px; }
  .m-log-line { font-size: 12px; color: #ccccee; line-height: 1.5; }
`;

/** Show the changelog overlay. Resolves when the player closes it. */
export function showChangelog(): Promise<void> {
  addStyle("m-changelog-style", CSS);
  return new Promise((resolve) => {
    const menu = menuPanel({ variant: "wide", onEscape: close });
    function close() {
      menu.destroy();
      resolve();
    }

    const scroll = el("div", { className: "m-scroll" });
    for (const version of CHANGELOG) {
      const head = el("div", { className: "m-log-head" }, [
        el("span", {
          className: "m-log-ver-name",
          text: version.released ? `v${version.version}` : version.version,
        }),
        el("span", {
          className: "m-log-date",
          text: version.date ?? "in progress",
        }),
      ]);

      const groups: HTMLElement[] = [];
      for (const kind of KIND_ORDER) {
        const changes = version.changes.filter((c) => c.kind === kind);
        if (changes.length === 0) continue;
        groups.push(
          el("div", { className: "m-log-group" }, [
            el("div", { className: `m-log-kind ${kind}`, text: KIND_LABELS[kind] }),
            el(
              "div",
              { className: "m-log-lines" },
              changes.map((c) => el("div", { className: "m-log-line", text: c.text })),
            ),
          ]),
        );
      }
      if (groups.length === 0) {
        groups.push(el("div", { className: "m-empty", text: "Nothing yet." }));
      }

      scroll.appendChild(el("div", { className: "m-log-ver" }, [head, ...groups]));
    }

    menu.panel.append(
      el("h2", { className: "m-title", text: "CHANGELOG" }),
      scroll,
      el("div", { className: "m-actions end" }, [button("Back", close, "primary")]),
    );
  });
}
