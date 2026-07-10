import { CLIENT_WEAPON_REGISTRY } from "../weapons";

interface PlaceholderEntry {
  category: string;
  id: string;
}

function collectPlaceholders(): PlaceholderEntry[] {
  const out: PlaceholderEntry[] = [];
  for (const [id, def] of Object.entries(CLIENT_WEAPON_REGISTRY)) {
    if (def.placeholder) out.push({ category: "Weapon", id });
  }
  return out;
}

export function reportPlaceholders(): void {
  const placeholders = collectPlaceholders();

  if (placeholders.length === 0) {
    console.log("%c[Assets] All sprites are real art — nothing placeholder.", "color: #48bb78");
    return;
  }

  const byCategory: Record<string, PlaceholderEntry[]> = {};
  for (const p of placeholders) {
    (byCategory[p.category] ??= []).push(p);
  }

  console.group(
    `%c[Assets] ${placeholders.length} placeholder sprite(s) still need artwork:`,
    "color: #f6e05e; font-weight: bold",
  );
  for (const [category, entries] of Object.entries(byCategory)) {
    console.group(`%c${category}`, "color: #63b3ed");
    console.table(entries.map((e) => ({ id: e.id })));
    console.groupEnd();
  }
  console.groupEnd();

  if (import.meta.hot) {
    import.meta.hot.send("assets:placeholders", {
      count: placeholders.length,
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([cat, entries]) => [cat, entries.map((e) => e.id)]),
      ),
    });
  }
}
