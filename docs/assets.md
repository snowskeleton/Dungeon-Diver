# Assets

Read this when adding or replacing art.

All sprites are finished-art PNGs dropped straight into `assets/` (guy, gal, skeleton, skeleton-mage, goos, bat, FX strips). There is no source format to compile — art goes in as a PNG and gets copied to the client verbatim.

**One exception: `dungeon-tiles.png` is build output, not art.** It is drawn pixel-by-pixel by `generate-dungeon-tiles.js` (see below). Editing it by hand works until the next regeneration silently throws the edit away.

## The one command

```bash
npm run assets:build      # = node assets/sync-to-client.js
```

`sync-to-client.js` copies every `assets/*.png` into `client/public/sprites/`, and recursively copies the `weapons/` and `ammo/` PNG trees out of `shared/src/` into `client/public/sprites/<label>/`, preserving folder structure. Vite serves `public/` as static files; Phaser loads sprites from `/sprites/<name>.png`.

**Gotcha**: dropping a PNG into `assets/` does nothing until you run `npm run assets:build`. Phaser keeps loading the old version from `client/public/sprites/` until then. **Always run it after replacing any PNG in `assets/`.**

## Other scripts in `assets/`

- `generate-dungeon-tiles.js` — **the dungeon tileset.** Builds both `assets/dungeon-tiles.png` and `client/src/map/tilesetFrames.generated.ts` (the frame table the renderer indexes) in one run. Walls and the floor are **sampled from the Super Overhead Adventure 2 dungeon sheet** (`Environments/Dungeon.png` — the same pack the characters/enemies/bosses came from); stairs, trap, boss passage, fire, slime, wall shadow and the door portcullis are drawn procedurally (small, animated, or absent from the pack). Run with **`npm run assets:tiles`** (regenerates + syncs); add `TILE_PREVIEW=/tmp/rooms.png` to also dump a sample room. The source sheet lives **outside the repo** (like the SOA2 character import) — the committed PNG + table are what the game loads, so you only need the source to re-run; override its path with `SOA2_DUNGEON=/path/to/Dungeon.png`. **Only `pngjs` is required, which IS a project dependency** — unlike the `sharp` scripts below, this runs with no extra install. We use **one colour set — the blue/cyan set**; the author's `Examples/Zaldo/Example Dungeon.png` is the reference for how it composes. The floor is a dark-blue **flagstone** — stones inset in mortar, DRAWN in the example's two-colour palette (`STONE`/`MORTAR`) at three sizes (tiny/regular/large) with per-stone jitter + slight rotation for a hand-placed look; `TileRenderer` picks a size plan per room and scatters variants. In-room obstacles ("cover"/tetris pieces) use the sheet's raised cyan blocks (`BLOCK_SRC`); the room's structural walls autotile from the cyan brick (`WALL_BRICK`). Repoint `WALL_BRICK`/`BLOCK_SRC` or the stone palette to reskin. Why generated rather than a hand-cut atlas: the 47 wall-blob frames have to be mutually consistent or walls grow wrong edges at some room shape nobody tested, and the frame indices have to match the renderer — both guaranteed by construction. See the tileset section in [../CLAUDE.md](../CLAUDE.md).
- `generate-weapons.js` — splits `weapon-icons.png` into per-weapon PNGs and writes per-weapon TypeScript definition files into `shared/src/weapons/{category}/{id}/`.
- `generate-fx-hurtboxes.js` + `generate-enemy-hurtboxes.ts` — derive melee hitboxes from the art, so no reach or hurt size is ever hand-tuned. The first measures the four attack-FX strips into `shared/src/weapons/fxHurtboxes.generated.ts` (a weapon's swing hurtbox); the second measures every enemy + player spritesheet into `shared/src/enemies/hurtBounds.generated.ts` (what each creature can be *hit* on). Both outputs are committed. **`npm run assets:hurtboxes` runs both** — re-run after editing any FX strip, adding an enemy, or replacing a creature sheet. The enemy generator reads `client/src/enemies/spriteGeometry.ts`, so a new enemy needs its geometry there first.
- `generate-snake-sheets.js` — the Snakes art ships as three per-direction strips instead of one sheet; this composes `fang.png` / `hood-fang.png` into the standard 4-row directional layout (the "left" row is the side strip mirrored per-frame). The output is committed, so only re-run it if the source art changes.

`generate-weapons.js` and `generate-snake-sheets.js` require `sharp`, which is **not** a project dependency: `npm install --no-save sharp` first.

## Sprite-sheet grid alignment (bit us once)

Don't assume a sprite sheet's icons sit on a clean `N`-px grid starting at `(0,0)`. Detect the true frame boundaries first by scanning for content bands — rows/columns of all-transparent pixels between icons:

```js
// for each y, does any pixel in that row have alpha>0? Find contiguous "on" bands -> row boundaries.
// Repeat per-row for columns -> per-row icon x-ranges. Compare against your assumed cell*index math
// before trusting it — a wrong guess silently packs each frame with a slice of its neighbor
// instead of erroring.
```

Related: when rescaling, always work from the **original source PNG**, never from prior output. A scale-2 PNG has 64px cells, so re-sampling it as if cells were 32px grabs quarter-frames.

## Sheet layouts

- **Humanoid characters**: 15 cols × 4 rows at 32×32. See [animation.md](animation.md).
- **Enemies (horizontal)**: one side view, mirrored for left. Usually a single-row strip, cell size varies (goos 6×1 @32, bats 6×1 @16, rat 8×1 @20); some are multi-row (spider 6×3 of 32×16, frog-flower 4×3 @32) or share a sheet across colour variants (float-skull 3×3 @16).
- **Enemies (directional)**: 4 rows of 4 frames @16 — up / right / down / left, never mirrored (bones, kultist, the beasts, snakes).
- **Bosses**: horizontal, big sheets, rendered at 2× (turtle-dragon 16×1 @32, wyverns 4×2 @32, centaur-knight + big-beast 8×4 @32, tengu-mask 18×4 @32, batwing-buttstomper 8×6 @40).
- **Attack FX strips**: right-facing, 4 frames. See [weapons-and-ammo.md](weapons-and-ammo.md).
- **Weapon/ammo icons**: live beside their config under `shared/src/weapons/` and `shared/src/ammo/`, not in `assets/`.

An enemy sheet's PNG basename must equal the enemy id, unless its def sets an explicit `textureKey`. See [enemies.md](enemies.md).
