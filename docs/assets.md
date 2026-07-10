# Assets

Read this when adding or replacing art.

All sprites are finished-art PNGs dropped straight into `assets/` (guy, gal, skeleton, skeleton-mage, goos, bat, FX strips, the tileset). There is no source format to compile — art goes in as a PNG and gets copied to the client verbatim.

## The one command

```bash
npm run assets:build      # = node assets/sync-to-client.js
```

`sync-to-client.js` copies every `assets/*.png` into `client/public/sprites/`, and recursively copies the `weapons/` and `ammo/` PNG trees out of `shared/src/` into `client/public/sprites/<label>/`, preserving folder structure. Vite serves `public/` as static files; Phaser loads sprites from `/sprites/<name>.png`.

**Gotcha**: dropping a PNG into `assets/` does nothing until you run `npm run assets:build`. Phaser keeps loading the old version from `client/public/sprites/` until then. **Always run it after replacing any PNG in `assets/`.**

## Other scripts in `assets/`

- `generate-weapons.js` — splits `weapon-icons.png` into per-weapon PNGs and writes per-weapon TypeScript definition files into `shared/src/weapons/{category}/{id}/`.

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
- **Enemies**: single-row strips (goos 6×1 @ 32×32, bat 6×1 @ 16×16). See [enemies.md](enemies.md).
- **Attack FX strips**: right-facing, 4 frames. See [weapons-and-ammo.md](weapons-and-ammo.md).
- **Weapon/ammo icons**: live beside their config under `shared/src/weapons/` and `shared/src/ammo/`, not in `assets/`.
