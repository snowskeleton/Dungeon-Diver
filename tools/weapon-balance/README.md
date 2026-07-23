# Weapon &amp; Ammo Balance tool

A dev-only spreadsheet of every weapon **and** every ammo (projectile), with
inline editing that writes straight back to the source. Sibling of
[`../enemy-balance`](../enemy-balance). **Not part of the game build.**

```bash
npm run balance:weapons     # → http://localhost:4601   (BALANCE_PORT to override)
```

## What it shows

Two **sheets**, each with its own columns:

- **Weapons** — damage, attack cooldown, knockback (`attackForce`), icon angle.
- **Ammo (projectiles)** — damage, speed, pierce, knockback, lifetime, and the
  hit-ellipse radii (forward/side).

Each sheet opens with a **Base defaults** table of the classes everything
inherits from — `Weapon` + each weapon category base, and `Ammo` + `Arrow` /
`Bolt` / `Boomerang`. Editing a base cell changes the default every inheriting
item reads, unless it overrides. Below that, concrete items are grouped (weapon
category / ammo family, with flat ammo under **One-offs**).

Per cell:

- **Provenance** — purple bar + bold = defined on that class; dim italic =
  inherited (hover for the source class).
- **Balance** — warm above the group's column average, cool below; an `average`
  row sits under each group. Base-defaults tables are uncolored (different tiers
  aren't comparable).

Click a value to edit; **↺** (shown only when there's an inherited value to fall
back to) removes the override. No git integration — review the diff and commit
through your normal flow.

## How it works

Weapons and ammo are both OO now — `Base → category base → concrete` chains of
getter overrides — so one engine drives both:

- [`getterSheet.ts`](getterSheet.ts) — the generic analyzer/editor. Reads classes
  with the TypeScript compiler API (no game code runs), resolves each stat up the
  `extends` chain **through each file's import bindings** (so aliased bases like
  `class Arrow extends ArrowBase` / `class Spear extends SpearBase` resolve
  correctly), and writes edits as precise AST-span splices.
- [`weaponData.ts`](weaponData.ts) / [`ammoData.ts`](ammoData.ts) — thin
  `SheetConfig`s (root dir, columns, grouping) over that core.
- [`server.ts`](server.ts) serves both sheets and routes edits by `domain`.

### Limits

- Numeric stat getters only. Behaviour/visual selectors (`fxType`, `ammoId`,
  `rangedStyle`, `spriteAngle`, `spinDegPerSec`, `tint`) aren't shown; weapon
  melee reach is measured from FX art, not a number; and ranged **weapon**
  `damage` is a flat muzzle bonus (usually 0) — the real ranged damage is on the
  ammo, which is why both live in one tool.
- A getter whose body isn't a plain number shows `n/a` and isn't editable.
