// A generic DOM settings panel rendered from a declarative field spec.
//
// Both the Options screen and the Debug menu are just a list of FieldSpecs over a
// plain config object — adding a knob means adding one property to that object and
// one entry to its field list. Nothing in this file knows what a dungeon is.

import { addStyle, button, el, menuPanel } from "./menuDom";

export interface Choice {
  value: string;
  label: string;
}

export type FieldSpec<T> =
  | { kind: "toggle"; key: keyof T & string; label: string; help?: string }
  | { kind: "number"; key: keyof T & string; label: string; help?: string; min?: number; max?: number; step?: number }
  | { kind: "select"; key: keyof T & string; label: string; help?: string; options: Choice[] }
  | { kind: "multiselect"; key: keyof T & string; label: string; help?: string; options: Choice[] };

/** A named starting point that overwrites the whole draft (rendered as a chip row). */
export interface Preset<T> {
  label: string;
  values: Partial<T>;
}

export interface PanelButton {
  /** Returned as the promise's `button` field. */
  id: string;
  label: string;
  primary?: boolean;
}

export interface PanelResult<T> {
  /** id of the button pressed, or "cancel" if dismissed with Escape. */
  button: string;
  values: T;
}

// A settings row is a two-column grid — a labelled control with its help text
// under the label — which no other panel here wants. The controls themselves
// wear menuDom's `.m-input` / `.m-chip`.
const CSS = `
  .fp-row {
    display: grid; grid-template-columns: 190px 1fr; gap: 12px;
    align-items: center; padding: 7px 0; border-bottom: 1px solid #2a2a4a;
  }
  .fp-label { font-size: 12px; color: #ccccee; }
  .fp-help { display: block; font-size: 10px; color: #777799; margin-top: 2px; line-height: 1.3; }
`;

export function showFieldPanel<T extends object>(opts: {
  title: string;
  fields: FieldSpec<T>[];
  initial: T;
  buttons: PanelButton[];
  presets?: Preset<T>[];
}): Promise<PanelResult<T>> {
  return new Promise((resolve) => {
    const draft: T = structuredClone(opts.initial);

    const finish = (id: string) => {
      menu.destroy();
      resolve({ button: id, values: draft });
    };
    // `swallowKeys`: the panel sits over a Phaser scene that also listens for
    // keys, and it is full of text fields.
    const menu = menuPanel({
      onEscape: () => finish("cancel"),
      swallowKeys: true,
    });
    addStyle("fp-style", CSS);

    const body = el("div", { className: "m-scroll" });
    const renderFields = () => {
      body.replaceChildren(...opts.fields.map((field) => {
        const label = el("div", { className: "fp-label", text: field.label });
        if (field.help) label.appendChild(el("span", { className: "fp-help", text: field.help }));
        return el("div", { className: "fp-row" }, [label, renderControl(draft, field)]);
      }));
    };
    renderFields();

    if (opts.presets?.length) {
      menu.panel.appendChild(el("div", { className: "m-chips" }, opts.presets.map((preset) =>
        el("button", {
          className: "m-chip round",
          text: preset.label,
          onClick: () => {
            Object.assign(draft, structuredClone(preset.values));
            renderFields();
          },
        }),
      )));
    }

    menu.panel.prepend(el("h2", { className: "m-title", text: opts.title }));
    menu.panel.append(
      body,
      el("div", { className: "m-actions end" }, opts.buttons.map((btn) =>
        button(btn.label, () => finish(btn.id), btn.primary ? "primary" : ""),
      )),
    );
  });
}

function renderControl<T extends object>(draft: T, field: FieldSpec<T>): HTMLElement {
  const set = (value: unknown) => { (draft as Record<string, unknown>)[field.key] = value; };
  const get = () => (draft as Record<string, unknown>)[field.key];

  switch (field.kind) {
    case "toggle": {
      const input = el("input", { className: "m-input" });
      input.type = "checkbox";
      input.checked = get() as boolean;
      input.addEventListener("change", () => set(input.checked));
      return input;
    }
    case "number": {
      const input = el("input", { className: "m-input fill" });
      input.type = "number";
      input.value = String(get());
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.step = String(field.step ?? 1);
      input.addEventListener("change", () => {
        const raw = Number(input.value);
        const clamped = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, raw));
        if (!Number.isFinite(clamped)) return;
        set(clamped);
        input.value = String(clamped);
      });
      return input;
    }
    case "select": {
      const select = el("select", { className: "m-input fill" });
      for (const choice of field.options) {
        const option = el("option", { text: choice.label });
        option.value = choice.value;
        option.selected = choice.value === get();
        select.appendChild(option);
      }
      select.addEventListener("change", () => set(select.value));
      return select;
    }
    case "multiselect": {
      const isOn = (value: string) => (get() as string[]).includes(value);
      return el("div", { className: "m-chips" }, field.options.map((choice) => {
        const chip = el("button", {
          className: `m-chip${isOn(choice.value) ? " on" : ""}`,
          text: choice.label,
        });
        chip.addEventListener("click", () => {
          const next = new Set(get() as string[]);
          if (next.has(choice.value)) next.delete(choice.value);
          else next.add(choice.value);
          set([...next]);
          chip.classList.toggle("on", isOn(choice.value));
        });
        return chip;
      }));
    }
  }
}
