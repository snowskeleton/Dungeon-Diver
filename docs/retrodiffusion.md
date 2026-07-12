# RetroDiffusion — AI pixel-art generation

Read this before generating any game art with RetroDiffusion (RD). It defines
**what** we ask RD for, **how** we review cheaply before spending, and **how** RD
output gets from a raw PNG into the game's real sprite pipeline.

RD is a hosted pixel-art image generator (the Aseprite plugin's backend, exposed
as an HTTP API). We use it as a **first-draft art source** — it produces genuinely
good single pixel-art images. It is *not* a sprite-sheet animator that emits our
exact grid layouts, so the workflow below is built around that gap.

> **This doc was written from live API tests.** All prices, limits, and the
> credits-vs-balance behaviour below were measured against the real account, not
> copied from marketing pages. See [the tool](../tools/retrodiffusion/rd.mjs).

## The tool

Everything goes through `tools/retrodiffusion/rd.mjs` — a dependency-free Node CLI.
Its one job beyond calling the API: **you cannot spend money by accident.** Every
`gen` runs a free `check_cost` dry-run first and refuses to bill more than
`--max-cost` (default $0.05).

```bash
cd tools/retrodiffusion
node rd.mjs balance                                    # credits + $ balance
node rd.mjs cost --style rd_fast__default --size 64 --n 4 --prompt "..."   # free quote
node rd.mjs gen  --style rd_fast__default --size 64 --n 4 --nobg --name potion \
     --prompt "a red health potion, game item icon, centered"              # generate
```

- **Auth**: the API key lives in `tools/retrodiffusion/.env` (`RD_API_KEY=rdpk-…`),
  which is **gitignored** — the key never enters version control. `rd.mjs` also
  reads `RD_API_KEY` from the environment if you prefer.
- **Output**: PNGs plus a `meta.json` (prompt/style/size/seed/cost) land in
  `tools/retrodiffusion/out/<name>/` — also gitignored (scratch, not committed).
  Finished art gets promoted into `assets/` by hand (see "Pipeline" below).
- **Flags**: `--seed N` (reproducibility), `--tile` (seamless X+Y for tilesets),
  `--nobg` (transparent background — use for every icon/prop/character),
  `--width/--height` (non-square), `--max-cost 0.08` (raise the guard for a final).
  Animation flags: `--spritesheet` (PNG sheet instead of GIF), `--frames N`
  (advanced-animation frame count 4–16), `--input path.png` (base64-encode a local
  frame as the img2img / advanced-animation start frame; `--strength 0–1`).
  Saved output auto-detects GIF vs PNG by magic bytes.

## Money model (measured, not guessed)

The account has **two separate pools**: monthly **credits** (50) and a **$ balance**
(~$0.30 as of this writing). **API generations bill the dollar balance, not the
credits** — every real call returned `credit_cost` alongside a `balance_cost` that
was the only thing actually deducted. So track the **balance**, and `node rd.mjs
balance` before/after a session.

Cost scales with **pixel area × model tier × num_images** (batching gives no
discount — 4 images cost 4×). Measured prices:

| Style / model | 32² | 64² | 128² | 256² |
|---|---|---|---|---|
| `rd_fast__*` | $0.017 | $0.017 | ~$0.02 | ~$0.03 |
| `rd_plus__*` | ~$0.02 | ~$0.02 | **$0.033** | $0.058 |
| `rd_pro__*` | — | — | ~$0.10 | **$0.18** |
| `rd_tile__tileset` | $0.10 flat | | | |
| `rd_animation__*` (walk/small/vfx) | **$0.07 flat** | | | |
| `rd_advanced_animation__*` (animate a start frame) | **$0.14 flat** | | | |

There is a **~$0.017 price floor** — a 32px `rd_fast` costs the same as a 64px one,
so preview at 64px (easier to judge) for the same money.

**Rule: always `cost` (or let `gen` dry-run) before spending. Preview on
`rd_fast`. Only pay for `rd_plus`/`rd_pro` on a concept you've already chosen.**

## Which assets RD is good / bad for

RD emits **one coherent image at the size you ask for**. Map that against our grids
(see [assets.md](assets.md)):

| Asset | Native grid | RD fit | Approach |
|---|---|---|---|
| **Weapon icons** | 32×32 / 64×32 | ✅ **direct** | one `--nobg` gen, drop in |
| **Ammo/projectiles** | 32×32 | ✅ **direct** | one `--nobg` gen, drop in |
| **Item / pickup icons** (Floor 3 upgrades) | 32×32 | ✅ **direct** | one `--nobg` gen |
| **Static props / decor** | any | ✅ **direct** | one `--nobg` gen |
| **Dungeon tiles / tileset** | tileset PNG | 🟡 good | `rd_tile__tileset --tile`, then slot frames into `dungeon-tiles.png` by hand |
| **Attack-FX strips** | 4-frame right-facing | 🟡 partial | `rd_animation__vfx` for effects, or hand-assemble poses |
| **Directional enemy walk sheets** | 4×4 @16/32 up/right/down/left | 🟢 **good (tested)** | `rd_animation__four_angle_walking` → a 4×4 @48 walk sheet; reorder rows to our facing order |
| **Enemy sheets (horizontal)** | e.g. 6×1 @32 | 🟡 workable | `rd_animation__small_sprites` (32²) or repack a directional row into a strip |
| **Action animations for EXISTING art** (attack/death/idle) | — | 🟢 **good (tested)** | `rd_advanced_animation__*`: feed a real game frame, get an in-style action sheet |
| **Humanoid character sheets** | 15×4 @32 | 🟠 hard | no single RD style emits the full 15-col layout; assemble from per-action animation sheets |

**Takeaway:** lead with icons, ammo, props, pickups, and tiles — the *one image at
a fixed size* wins. But the **animation models are the real unlock for this
project** (see next section): they produce fixed-layout sprite sheets, and the
advanced model animates our *own imported art* into the action rows it's missing.
Only the full 15×4 humanoid sheet remains genuinely hard — and even that can be
assembled from per-action animation sheets.

## Animations — the real unlock (tested)

RD has two animation families. Both can return a **PNG sprite sheet** (add
`--spritesheet` / `return_spritesheet: true`) instead of the default transparent
GIF, so output drops into our sheet pipeline. One animation per request.

**`rd_animation__*` — prompt-driven, fixed layouts ($0.07 flat):**
- `four_angle_walking` / `walking_and_idle` — **48×48 only**. Returns a **4×4 grid
  (192×192) = 4 directions × 4 walk frames.** *Tested:* a "green goblin warrior"
  came back as a clean, identity-consistent 4-direction walk cycle — rows are
  up(back) / side / down(front) / side. This maps onto `makeDirectionalEnemyDef`'s
  4-row layout; you only **reorder rows to up/right/down/left** (and `directionalEnemy.ts`
  already has the documented row-swap knob). Handle the 48px cell size in the def.
- `small_sprites` — 32×32 only. `vfx` — 24–96 square (explosions, hit effects,
  good for our attack-FX strips). `any_animation` — 64×64. `8_dir_rotation` — 80×80.

**`rd_advanced_animation__*` — animate a start frame ($0.14 flat):**
Upload **any pixel-art frame (32–256px) as `input_image`** and it animates *that
exact art*. Actions: `walking`, `idle`, `jump`, `crouch`, `attack`, `destroy`,
plus `custom_action` (describe any motion) and `subtle_motion` (ambient scene
life). `frames_duration` ∈ {4,6,8,10,12,16}; set width/height to the start frame.
- *Tested:* extracted the skeleton's down-idle frame (`assets/skeleton.png`, row 2
  col 0, 32×32) → `rd_advanced_animation__attack` → an **8-frame attack sheet
  (128×64, 4×2)** with a slash arc sweeping through, **preserving the skeleton's
  identity and palette**. Rough at 32px but a real, in-style base.
- **This is the fix for the biggest content gap:** the imported enemy/boss packs
  have unused attack/special/death rows (see [enemies.md](enemies.md),
  [bosses.md](bosses.md)). We can generate those rows *from the existing art* per
  action, then assemble them into each enemy's sheet. A neutral standing frame as
  input gives the best results.

**Gotchas (measured):**
- Advanced animations are **slow** (~60–120 s) — a synchronous request can outlast
  a short shell timeout even though it completes and bills. If it becomes flaky,
  switch `rd.mjs` to the `async: true` + poll `GET /v1/inferences/tasks/{id}` path.
- Sheets are **walk/action cycles only** — one action per call. A full enemy sheet
  = several calls (a walk sheet + an attack sheet + a death sheet), assembled by
  hand into our grid. Budget per enemy accordingly (~$0.07–0.14 × actions).
- Row/frame **order and cell size won't match our grid exactly** — every animation
  asset needs a repack pass (crop → reorder → place into the target sheet), same
  frame-boundary care as [assets.md](assets.md) warns about.

## Defining what we want — the asset spec

Before generating, write a one-line spec per asset so prompts are consistent and
reviewable. Keep the **subject only** in the prompt (RD's style handles the
"pixel art" part — don't say "pixel art, 8-bit, retro" or you fight the model):

```
id:      health-potion            # becomes the filename / registry id
type:    item-icon                # icon | ammo | prop | tile | fx | enemy
size:    32x32                    # target grid from assets.md
style:   rd_fast__default         # tier (fast to draft, plus/pro for final)
bg:      transparent              # → --nobg
prompt:  "a red health potion bottle with a cork stopper, centered, clean silhouette"
notes:   "must read at 32px; matches the warm palette of weapon-icons.png"
```

Good prompt habits, learned from testing:
- **One subject, centered, "clean silhouette"** — reads far better at 32–64px.
- Name the **color** explicitly ("red", "emerald") to hit our existing palettes.
- Avoid multi-object scenes for icons; RD sometimes doubles elements (one potion
  test produced a stacked double-cork).

## The review workflow (cheap → final)

This is the core loop — **never** pay for a final before judging a cheap draft.

1. **Draft** — `gen` on `rd_fast`, `--n 4`, 64px, `--nobg`. ~$0.07 for four
   variations. Cheapest way to explore silhouette/composition.
2. **Contact-sheet & judge** — composite the tiny PNGs scaled-up on a checkerboard
   so transparency is visible, then eyeball. (The one-off Python in
   `out/potion-preview/` that built `contact-sheet.png` is the pattern; a
   `contact-sheet` subcommand is a good addition to `rd.mjs`.)
3. **Pick a winner**, refine the prompt if needed, and repeat step 1 until happy —
   still all on cheap `rd_fast`.
4. **Final** — regenerate the chosen concept once on `rd_plus` (or `rd_pro` for
   hero art) at final size, `--max-cost` raised to the quote.

> **Reproducibility caveat (tested):** batch responses do **not** return per-image
> seeds, so you cannot "upscale image #2 of a batch." To make a winner
> reproducible, generate finals as **`--n 1` with an explicit `--seed`** you chose,
> or feed the chosen PNG back as an **img2img** `input_image` to refine it. Prefer
> self-assigned seeds for the clean path.

## Getting RD output into the game (pipeline)

RD gives you a raw PNG in `tools/retrodiffusion/out/`. To ship it:

1. **Get to native size.** Generate **at the target size directly** (32/48/64) —
   do **not** render at 128 and downscale; a naive downscale to 32px goes mushy
   (verified). If you must shrink, use RD's k-centroid resize (an edit tool) or a
   nearest/k-centroid pass, not a box filter.
2. **Promote the file** into `assets/<id>.png` (or, for weapon/ammo icons, beside
   their config under `shared/src/weapons|ammo/<…>/`).
3. **Wire it up** using the existing recipes — this doc does not replace them:
   - icons/ammo → [weapons-and-ammo.md](weapons-and-ammo.md)
   - enemies → [enemies.md](enemies.md)
   - tiles → the "Add a tile type" steps in [../CLAUDE.md](../CLAUDE.md)
4. **`npm run assets:build`** — nothing shows in-game until you do (see
   [assets.md](assets.md)).

RD is a **source of raw art**, and this doc is the on-ramp; the registry/OO
conventions in the docs above are still the law for how art becomes a live entity.

## Good first targets (highest value, lowest risk)

All are single-image, direct-fit, and genuinely useful:

1. **Floor-3 upgrade / pickup icons** (32×32) — the upgrade system is the next
   real gap (per project notes); it'll need a set of item icons. Perfect RD fit.
2. **New weapon icons** (32×32 / 64×32) to widen the shop pool — matches the
   existing `weapon-icons.png` set.
3. **New ammo sprites** (32×32) — trivial to add (a weapon just points at an
   `ammoId`), so new projectiles are cheap content.
4. **Dungeon decor / props** — barrels, torches, statues to dress rooms.

## Open questions for Isaac

- **Scope**: happy to lead with icons/ammo/props/tiles (the easy, direct-fit
  wins), and treat animated enemy/character **sheets** as a later experiment? Or
  is a full new enemy the real goal (much more manual assembly per asset)?
- **First batch**: want me to draft a set of **Floor-3 upgrade item icons**, or
  **new weapons/ammo** for the shop? Give me a theme and I'll spec + preview them
  cheaply for your review before any final spend.
- **Budget**: **~$0.09 balance remains** after de-risking tests (icons + both
  animation models). That's only ~5 more `rd_fast` previews or ~1 animation. You'll
  likely want to **top up the RD balance** before a real content batch — say what
  cap you want me to work within.

## Session log

- Verified auth, the free `check_cost` dry-run, and the `--max-cost` guard.
- Confirmed API bills the **$ balance**, not the 50 credits.
- **Icons**: `rd_fast`×4 preview ($0.069) + `rd_plus` 128px final ($0.033) of a red
  potion → clean, drop-in pixel art with working transparency.
- **Directional walk sheet** ($0.07): `four_angle_walking` → a coherent 4×4 @48
  goblin walk cycle that maps to our directional layout.
- **Advanced animation** ($0.14): fed the game's own skeleton idle frame to
  `advanced_animation__attack` → an in-style 8-frame attack sheet. Proves we can
  animate existing imported art into its missing action rows.
- Total test spend **~$0.31**; **~$0.09 balance remaining**. All outputs in
  `tools/retrodiffusion/out/` (gitignored).
