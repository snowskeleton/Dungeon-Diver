#!/usr/bin/env node
// Copies compiled sprite PNGs from assets/ into client/public/sprites/ so
// Phaser can load them at runtime (Vite serves public/ as static files).
// Also recursively copies weapon PNGs from shared/src/weapons/ maintaining
// subdirectory structure under client/public/sprites/weapons/.
const fs = require("fs");
const path = require("path");

const srcDir = __dirname;
const destDir = path.join(__dirname, "..", "client", "public", "sprites");

fs.mkdirSync(destDir, { recursive: true });

// Flat PNGs from assets/
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith(".png")) continue;
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  console.log(`Synced ${file} -> client/public/sprites/${file}`);
}

// Nested PNGs from shared/src/<label>/ → client/public/sprites/<label>/,
// preserving the folder structure (used by weapons and ammo).
function copyTree(srcBase, destBase, label, relPath = "") {
  const full = path.join(srcBase, relPath);
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      copyTree(srcBase, destBase, label, rel);
    } else if (entry.name.endsWith(".png")) {
      const dest = path.join(destBase, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(srcBase, rel), dest);
      console.log(`Synced ${label}/${rel} -> client/public/sprites/${label}/${rel}`);
    }
  }
}

const sharedSrc = path.join(__dirname, "..", "shared", "src");
for (const label of ["weapons", "ammo"]) {
  copyTree(path.join(sharedSrc, label), path.join(destDir, label), label);
}
