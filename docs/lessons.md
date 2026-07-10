# Lessons & patterns

Archived wisdom from features that were built, learned from, and in some cases removed. Nothing here describes current code — read it when you're about to build the *kind* of thing it describes.

## Layered weapon sprites (if you ever need a persistently-visible weapon)

Attacks currently render as one-shot FX strips, not a persistent weapon sprite. If a future feature needs one (a wizard's staff idle pose, a shield), the old sword code showed the shape:

- Give the weapon its own Phaser sprite.
- Find its grip point by dumping the alpha channel row-by-row, and `setOrigin` there so rotation happens around the hand.
- Drive position/rotation from the character's `(action, facing)` each frame with edge-detected tweens.
- Set per-facing `depth` so it doesn't float through the body.

## Live-tuning numeric constants instead of asking Claude

For anything driven by a small set of numeric constants (angles, offsets, scale, timing), prefer making them **live-editable in-browser** over a back-and-forth of "change the number, reload, describe what you see." The sword debug panel that pioneered this was removed along with the layered sword, but the pattern is the takeaway:

1. Put every tunable in one exported **mutable** object (not `const`s). Code that uses the values re-reads the object fresh each frame instead of capturing them once, so edits apply on the very next action with no reload.
2. Build a plain-DOM debug panel — range sliders + number inputs bound directly to that object's fields via closures, no Phaser/React dependency. Toggle it with a keybind so it doesn't clutter normal play.
3. Wire a page-level panel's init into `main.ts`, not `GameScene`, since it's an overlay independent of scene lifecycle.
4. Keep a `default*Tunables` frozen copy for the panel's reset button.

**Gotcha**: an in-progress Phaser tween will silently overwrite an angle you set by hand (e.g. from a devtools console) — the tween owns that property until it finishes or is explicitly killed (`scene.tweens.killTweensOf(target)`). This only matters for console/scripted testing, not for a tunables panel (which edits the *source* values the next action reads, not a mid-flight sprite property).

**Label the axis that actually matters per state, not raw X/Y.** The old sword panel exposed raw `offsetX`/`offsetY` sliders for every facing, but for down/up swings Y is the axis that visibly moves the sword (the "reach" out from the body) while for left/right it's X. Tweaking `offsetY` on a left/right swing did technically work, but only nudged the sword *perpendicular* to the swing — easy to mistake for "this control is broken." Fix: relabel per-facing so the visually dominant control is always called the same thing (`reach`), with the other called `drift`. When adding a new tunable group, ask "does this control mean something different depending on state?" before shipping a raw-coordinate slider.

The current in-game debug tool is `client/src/debug/HitboxDebug.ts` — press **H** to draw every hit/hurtbox in the scene live.

## Piping client output to the terminal instead of the browser console

If the user's workflow centers on the terminal running `npm run dev` rather than devtools, use the tiny Vite plugin (`terminalLogPlugin` in `client/vite.config.ts`) that listens on `server.ws.on("<channel>", ...)` and `console.log`s whatever arrives — that log lands in the same terminal `npm run dev` is running in.

Client side, guard with `if (import.meta.hot) import.meta.hot.send("<channel>", data)` (requires `"types": ["vite/client"]` in `client/tsconfig.json` for the `import.meta.hot` type). Dev mode only, which is exactly when you'd want it.

Current users: the generic `debug:log` channel, and `client/src/dev/PlaceholderReport.ts`, which sends `assets:placeholders` so the dev terminal prints an "ASSET STATUS" box listing which sprites are still colored-rectangle placeholders (driven by the `placeholder` flags in `client/src/weapons/index.ts`).
