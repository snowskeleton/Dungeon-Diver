# RetroDiffusion asset generator

Dependency-free Node CLI for generating pixel-art with the RetroDiffusion API.
**Full scope, workflow, prices, and asset-fit guide: [docs/retrodiffusion.md](../../docs/retrodiffusion.md).**

## Setup

Put your API key in `.env` (gitignored):

```
RD_API_KEY=rdpk-...
```

## Use

```bash
node rd.mjs balance
node rd.mjs cost --style rd_fast__default --size 64 --n 4 --prompt "..."
node rd.mjs gen  --style rd_fast__default --size 64 --n 4 --nobg --name potion --prompt "..."
```

`gen` always runs a free `check_cost` dry-run first and refuses to bill more than
`--max-cost` (default $0.05). Output + a `meta.json` sidecar land in `out/<name>/`
(gitignored). Flags: `--seed --width --height --tile --nobg --name --max-cost`.

Animations (see the scope doc): `--spritesheet` (PNG sheet vs GIF), `--frames N`
(advanced-anim frames 4–16), `--input path.png` + `--strength 0–1` (img2img /
advanced-animation start frame). Examples:

```bash
# 4-direction walk sheet (192x192, 4x4 @48)
node rd.mjs gen --style rd_animation__four_angle_walking --size 48 --n 1 --spritesheet --nobg \
     --name goblin-walk --max-cost 0.08 --prompt "a small green goblin warrior"

# animate an EXISTING game frame into an attack sheet
node rd.mjs gen --style rd_advanced_animation__attack --size 32 --n 1 --frames 8 --spritesheet \
     --input out/skeleton-idle.png --name skel-attack --max-cost 0.15 --prompt "swings weapon forward"
```

## Viewing output

Output is small (32–64px), so it's tiny in a normal viewer:

```bash
open out/<name>/          # Finder folder (space-preview to flip through)
open out/<name>/0.png     # a single image
```

To judge pixel art properly, scale it up on a checkerboard so transparency shows.
There is no `view` subcommand yet — the pattern is the ad-hoc Python (PIL, NEAREST
resize onto a checkerboard) used during setup. **TODO: add a `node rd.mjs view
<name>` subcommand** so previewing needs no Python. To extract a start frame for
`--input`, crop a single cell from an `assets/*.png` sheet (also PIL).
