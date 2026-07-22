# Enemy Balance tool

A dev-only spreadsheet of every enemy/boss and its tunable numeric stats, with
inline editing that writes straight back to the enemy source. **Not part of the
game build** — for the designers (us), not players.

```bash
npm run balance          # → http://localhost:4600   (BALANCE_PORT to override)
```

## What it shows

A top **Base defaults** table holds the base classes every enemy inherits from —
`Enemy`, `Boss`, and `DirectionalEnemy`. Editing a cell there changes the
*default* that flows to every enemy which doesn't override that stat (it rewrites
the getter in `Enemy.ts` / `Boss.ts`). That group is shown without averages or
color-ranking, since a `Boss` default and an `Enemy` default aren't comparable.

Below it, one row per concrete enemy, grouped into **Regular enemies** (`REGULAR_ENEMIES`),
**Bosses** (`BOSSES`), and **Summons / other** (id-carrying classes in neither
list, e.g. the Tengu Shade). Columns are the eight tunable stats from the `Enemy`
base: max HP, speed, aggro radius, attack reach, attack damage, attack cooldown,
knockback resistance, cruise height.

Each cell tells you two things at a glance:

- **Provenance.** A blue left-bar + bold = the stat is **defined on that class**.
  Dim italic = **inherited** from a base class (hover to see which — `Enemy`,
  `Boss`, or `DirectionalEnemy`).
- **Balance.** Background is warm when the value is above its group's column
  average, cool when below; intensity scales with the deviation. An `average`
  row sits at the bottom of each table.

Click a column header to sort by it.

## Editing

- Click a value, type a new number, press Enter (or blur). It writes the change
  into the real `.ts` source — replacing the getter's return value if the class
  already defines it, or **inserting a `protected get …()` override** on that
  class if the value was inherited. The written code matches the codebase's
  single-line getter style, so it stays OO and compiler-checked (no data blob,
  no id→config table — see `CLAUDE.md`).
- Hover a **specific** (overridden) cell and click **↺** to delete that override
  and fall back to the inherited default.

There is deliberately **no git integration** — edit freely here, then review the
diff and commit through your normal flow.

## How it works

`enemyData.ts` reads the source with the TypeScript compiler API — no game code
is executed and matter-js is never loaded. It resolves each stat up the
`extends` chain (`GooBlue → Enemy`, a boss → `Boss → Enemy`), resolving
module-level numeric consts like `BAT_HOVER` along the way, and records which
class declared each getter. Writes are precise text splices at the AST node
spans. `server.ts` is a tiny `http` server exposing `GET /api/model` and
`POST /api/edit` and serving `index.html`.

### Scope / limits

- Only the eight shared numeric `Enemy` stats. Boss-specific getters
  (`stunImmunityMs`, `preferredRange`) and, deliberately, **boss movesets** are
  not editable here — a moveset is `abilities(): Spell[]`, not a flat number.
- A getter whose body isn't a plain number or a numeric const shows `n/a` and
  isn't editable (it can't be safely round-tripped as a literal).
- Editing a stat that was a shared const (e.g. a bat's `cruiseHeight`, which
  returns `BAT_HOVER`) de-links that one class to a literal rather than changing
  the const for every sibling.
