// A generic DOM settings panel rendered from a declarative field spec.
//
// Both the Options screen and the Debug menu are just a list of FieldSpecs over a
// plain config object — adding a knob means adding one property to that object and
// one entry to its field list. Nothing in this file knows what a dungeon is.

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

const CSS = `
  #field-panel-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.78);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; font-family: monospace;
  }
  #field-panel-modal {
    background: #1a1a2e; border: 2px solid #4a4a6a; border-radius: 8px;
    padding: 20px; width: 520px; max-width: 92vw; max-height: 88vh; overflow-y: auto;
    color: #e0e0ff;
  }
  #field-panel-modal h2 { margin: 0 0 14px; font-size: 16px; color: #aaaaff; letter-spacing: 1px; }
  .fp-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  .fp-preset {
    padding: 4px 10px; font-size: 11px; font-family: monospace; cursor: pointer;
    background: #2a2a4a; border: 1px solid #4a4a6a; border-radius: 12px; color: #aaaacc;
  }
  .fp-preset:hover { border-color: #8888ff; color: #fff; }
  .fp-row {
    display: grid; grid-template-columns: 190px 1fr; gap: 12px;
    align-items: center; padding: 7px 0; border-bottom: 1px solid #2a2a4a;
  }
  .fp-label { font-size: 12px; color: #ccccee; }
  .fp-help { display: block; font-size: 10px; color: #777799; margin-top: 2px; line-height: 1.3; }
  .fp-row input[type="number"], .fp-row select {
    background: #12121f; border: 1px solid #4a4a6a; border-radius: 4px; color: #e0e0ff;
    font-family: monospace; font-size: 12px; padding: 4px 6px; width: 100%;
  }
  .fp-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #6666dd; }
  .fp-multi { display: flex; flex-wrap: wrap; gap: 5px; }
  .fp-chip {
    padding: 4px 10px; font-size: 11px; font-family: monospace; cursor: pointer;
    background: #2a2a4a; border: 1px solid #4a4a6a; border-radius: 4px; color: #aaaacc;
  }
  .fp-chip.on { background: #4a4aaa; border-color: #8888ff; color: #fff; }
  #field-panel-footer { display: flex; justify-content: flex-end; margin-top: 18px; gap: 8px; }
  .fp-btn {
    padding: 6px 16px; font-size: 12px; font-family: monospace; cursor: pointer;
    border-radius: 4px; border: 1px solid #4a4a6a; background: #2a2a4a; color: #aaaacc;
  }
  .fp-btn.primary { background: #4a4aaa; color: #fff; border-color: #8888ff; }
`;

function ensureStyles() {
  if (document.getElementById("fp-style")) return;
  const style = document.createElement("style");
  style.id = "fp-style";
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function showFieldPanel<T extends object>(opts: {
  title: string;
  fields: FieldSpec<T>[];
  initial: T;
  buttons: PanelButton[];
  presets?: Preset<T>[];
}): Promise<PanelResult<T>> {
  ensureStyles();

  return new Promise((resolve) => {
    const draft: T = structuredClone(opts.initial);

    const overlay = document.createElement("div");
    overlay.id = "field-panel-overlay";
    document.body.appendChild(overlay);

    const modal = document.createElement("div");
    modal.id = "field-panel-modal";
    overlay.appendChild(modal);

    const finish = (button: string) => {
      overlay.remove();
      window.removeEventListener("keydown", onKey);
      resolve({ button, values: draft });
    };
    const onKey = (e: KeyboardEvent) => {
      // The panel sits over a Phaser scene that also listens for keys.
      e.stopPropagation();
      if (e.key === "Escape") finish("cancel");
    };
    window.addEventListener("keydown", onKey);

    const title = document.createElement("h2");
    title.textContent = opts.title;
    modal.appendChild(title);

    const body = document.createElement("div");

    const renderFields = () => {
      body.innerHTML = "";
      for (const field of opts.fields) {
        const row = document.createElement("div");
        row.className = "fp-row";

        const label = document.createElement("div");
        label.className = "fp-label";
        label.textContent = field.label;
        if (field.help) {
          const help = document.createElement("span");
          help.className = "fp-help";
          help.textContent = field.help;
          label.appendChild(help);
        }
        row.appendChild(label);
        row.appendChild(renderControl(draft, field));
        body.appendChild(row);
      }
    };

    if (opts.presets?.length) {
      const presetRow = document.createElement("div");
      presetRow.className = "fp-presets";
      for (const preset of opts.presets) {
        const chip = document.createElement("button");
        chip.className = "fp-preset";
        chip.textContent = preset.label;
        chip.addEventListener("click", () => {
          Object.assign(draft, structuredClone(preset.values));
          renderFields();
        });
        presetRow.appendChild(chip);
      }
      modal.appendChild(presetRow);
    }

    renderFields();
    modal.appendChild(body);

    const footer = document.createElement("div");
    footer.id = "field-panel-footer";
    for (const btn of opts.buttons) {
      const el = document.createElement("button");
      el.className = "fp-btn" + (btn.primary ? " primary" : "");
      el.textContent = btn.label;
      el.addEventListener("click", () => finish(btn.id));
      footer.appendChild(el);
    }
    modal.appendChild(footer);
  });
}

function renderControl<T extends object>(draft: T, field: FieldSpec<T>): HTMLElement {
  const set = (value: unknown) => { (draft as Record<string, unknown>)[field.key] = value; };
  const get = () => (draft as Record<string, unknown>)[field.key];

  switch (field.kind) {
    case "toggle": {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = get() as boolean;
      input.addEventListener("change", () => set(input.checked));
      return input;
    }
    case "number": {
      const input = document.createElement("input");
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
      const select = document.createElement("select");
      for (const choice of field.options) {
        const option = document.createElement("option");
        option.value = choice.value;
        option.textContent = choice.label;
        option.selected = choice.value === get();
        select.appendChild(option);
      }
      select.addEventListener("change", () => set(select.value));
      return select;
    }
    case "multiselect": {
      const wrap = document.createElement("div");
      wrap.className = "fp-multi";
      for (const choice of field.options) {
        const chip = document.createElement("button");
        const isOn = () => (get() as string[]).includes(choice.value);
        chip.className = "fp-chip" + (isOn() ? " on" : "");
        chip.textContent = choice.label;
        chip.addEventListener("click", () => {
          const next = new Set(get() as string[]);
          if (next.has(choice.value)) next.delete(choice.value);
          else next.add(choice.value);
          set([...next]);
          chip.classList.toggle("on", isOn());
        });
        wrap.appendChild(chip);
      }
      return wrap;
    }
  }
}
