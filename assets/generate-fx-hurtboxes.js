#!/usr/bin/env node
// Derives melee hurtboxes from the attack FX art itself.
//
// For each attack-FX strip, this measures the opaque pixel bounds of every frame
// and writes them — in the FX's body-anchor coordinate space, right-facing — to
// shared/src/weapons/fxHurtboxes.generated.ts. That generated table is the ONLY
// definition of how far a melee swing reaches: a weapon's hurtbox is a
// consequence of its fxType, so new attack art gets a correct hitbox for free
// and hand-tuned reach numbers can't drift from what's drawn.
//
// Run via: node assets/generate-fx-hurtboxes.js
// The OUTPUT is checked in — re-run this only when an FX strip changes. The
// authoritative server must never decode a PNG at runtime, and the client H
// overlay has to agree with it exactly; a generated table gives both.
//
// Why this can just use the bounding box: the pack's *template* sheets draw a
// blue 16×16 body square to show where the character stands, but these generic
// strips are pure blade arc on transparency. Opaque bounds are the blade.

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

// Must match AttackFXSprites.ts: within each cell the character's body center
// sits this many px from the cell's top-left, NOT at the cell center. Bounds are
// emitted relative to it so they can be added straight to an entity's position.
const BODY_ANCHOR_PX = 24;

// Must match the frameRate the FX animations are defined at (AttackFXSprites.ts).
const FX_FRAME_RATE = 14;

// Alpha at or below this counts as transparent — guards against stray
// near-zero-alpha pixels at the edge of an antialiased arc inflating the box.
const ALPHA_THRESHOLD = 16;

const STRIPS = [
  { fxType: "slash", file: "slash-generic.png", fw: 48, fh: 48 },
  { fxType: "long-slash", file: "long-slash-generic.png", fw: 64, fh: 48 },
  { fxType: "stab", file: "stab-generic.png", fw: 64, fh: 48 },
  { fxType: "long-stab", file: "long-stab-generic.png", fw: 96, fh: 48 },
];

const OUT = path.join(__dirname, "..", "shared", "src", "weapons", "fxHurtboxes.generated.ts");

/** Opaque bounds of one frame, anchor-relative, or null if the frame is empty. */
function frameBounds(png, frameIndex, fw, fh) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const idx = (y * png.width + (frameIndex * fw + x)) * 4;
      if (png.data[idx + 3] <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null; // no opaque pixel — a wind-up frame

  // +1 on the far edge: bounds are inclusive pixel indices, w/h are extents.
  return {
    x: minX - BODY_ANCHOR_PX,
    y: minY - BODY_ANCHOR_PX,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

const entries = STRIPS.map(({ fxType, file, fw, fh }) => {
  const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, file)));
  const frameCount = png.width / fw;
  if (!Number.isInteger(frameCount)) {
    throw new Error(`${file}: width ${png.width} is not a multiple of frame width ${fw}`);
  }
  const frames = [];
  for (let i = 0; i < frameCount; i++) frames.push(frameBounds(png, i, fw, fh));
  return { fxType, file, frames };
});

const lines = [];
lines.push("// GENERATED FILE — do not edit by hand.");
lines.push("// Produced by assets/generate-fx-hurtboxes.js from the attack FX strips.");
lines.push("// Re-run that script after changing any FX art; see docs/weapons-and-ammo.md.");
lines.push("");
lines.push('import { StripFXType } from "./base";');
lines.push("");
lines.push("/** One frame's opaque bounds, relative to the caster's body center, drawn");
lines.push(" *  right-facing. null = the frame draws nothing, so the swing deals no damage");
lines.push(" *  during it (this is the swing's wind-up). */");
lines.push("export interface FxFrameBounds {");
lines.push("  x: number;");
lines.push("  y: number;");
lines.push("  w: number;");
lines.push("  h: number;");
lines.push("}");
lines.push("");
lines.push("/** How long each FX frame is on screen (ms) — the hurtbox timeline follows");
lines.push(" *  the animation's own frame rate, not the weapon's cooldown. */");
lines.push(`export const FX_FRAME_MS = ${(1000 / FX_FRAME_RATE).toFixed(4)};`);
lines.push("");
lines.push("export const FX_HURTBOX_FRAMES: Record<StripFXType, readonly (FxFrameBounds | null)[]> = {");
for (const { fxType, file, frames } of entries) {
  lines.push(`  // ${file}`);
  lines.push(`  "${fxType}": [`);
  for (const f of frames) {
    lines.push(f === null
      ? "    null,"
      : `    { x: ${f.x}, y: ${f.y}, w: ${f.w}, h: ${f.h} },`);
  }
  lines.push("  ],");
}
lines.push("};");
lines.push("");

fs.writeFileSync(OUT, lines.join("\n"));

console.log(`Wrote ${path.relative(path.join(__dirname, ".."), OUT)}`);
for (const { fxType, frames } of entries) {
  const drawn = frames.filter(Boolean);
  const reach = drawn.length ? Math.max(...drawn.map((f) => f.x + f.w)) : 0;
  console.log(`  ${fxType.padEnd(11)} ${frames.length} frames, ${drawn.length} drawn, reach ${reach}px`);
}
