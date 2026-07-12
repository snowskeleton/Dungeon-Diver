#!/usr/bin/env node
// RetroDiffusion API client for generating pixel-art assets.
//
// The whole point of this wrapper: you cannot spend money by accident.
// Every `gen` does a FREE check_cost dry-run first and refuses to bill more
// than --max-cost (default $0.05). Previews are cheap (rd_fast ~$0.017);
// finals are opt-in with a raised cap.
//
// Auth: reads RD_API_KEY from the environment or from tools/retrodiffusion/.env
// (KEY=value lines). The key is NEVER committed — see .gitignore here.
//
// Usage:
//   node rd.mjs balance
//   node rd.mjs cost   --style rd_fast__default --size 64 --n 4 --prompt "..."
//   node rd.mjs gen    --style rd_fast__default --size 64 --n 4 --prompt "..." [--seed 123] [--tile] [--nobg] [--max-cost 0.08]
//
// Output: PNGs + one <name>.json sidecar (prompt/style/size/seed/cost) land in
// tools/retrodiffusion/out/<name>/ so any generation is reproducible.

import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "https://api.retrodiffusion.ai/v1";
const OUT = join(HERE, "out");

function loadKey() {
  if (process.env.RD_API_KEY) return process.env.RD_API_KEY.trim();
  const envFile = join(HERE, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*RD_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  die("No API key. Set RD_API_KEY env var or put RD_API_KEY=... in tools/retrodiffusion/.env");
}

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[key] = true;
      else { a[key] = next; i++; }
    } else a._.push(t);
  }
  return a;
}

async function api(path, body, key) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "X-RD-Token": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { die(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`); }
  if (!res.ok) die(`API ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

function buildPayload(a) {
  if (!a.prompt) die("--prompt is required");
  if (!a.style) die("--style is required (e.g. rd_fast__default, rd_plus__default, rd_pro__default, rd_tile__tileset)");
  const size = Number(a.size || 64);
  const payload = {
    prompt: a.prompt,
    prompt_style: a.style,
    width: Number(a.width || size),
    height: Number(a.height || size),
    num_images: Number(a.n || 1),
  };
  if (a.seed !== undefined) payload.seed = Number(a.seed);
  if (a.tile) { payload.tile_x = true; payload.tile_y = true; }
  if (a.nobg) payload.remove_bg = true;
  // Animation params.
  if (a.spritesheet) payload.return_spritesheet = true;   // PNG sheet instead of GIF
  if (a.frames !== undefined) payload.frames_duration = Number(a.frames);  // 4,6,8,10,12,16
  // img2img / advanced-animation start frame: base64-encode a local PNG.
  if (a.input) {
    if (!existsSync(a.input)) die(`--input file not found: ${a.input}`);
    payload.input_image = readFileSync(a.input).toString("base64");
    if (a.strength !== undefined) payload.strength = Number(a.strength);
  }
  return payload;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));
  const key = loadKey();

  if (cmd === "balance") {
    const j = await api("/inferences/credits", null, key);
    console.log(`credits: ${j.credits}   balance: $${j.balance}`);
    return;
  }

  if (cmd === "cost") {
    const j = await api("/inferences", { ...buildPayload(a), check_cost: true }, key);
    console.log(`would cost $${j.balance_cost}  (balance now $${j.remaining_balance})`);
    return;
  }

  if (cmd === "gen") {
    const payload = buildPayload(a);
    const maxCost = Number(a["max-cost"] ?? 0.05);

    // 1. FREE dry-run to learn the exact price.
    const quote = await api("/inferences", { ...payload, check_cost: true }, key);
    const cost = quote.balance_cost;
    console.log(`quote: $${cost} for ${payload.num_images}× ${payload.width}×${payload.height} ${payload.prompt_style}`);
    if (cost > maxCost) {
      die(`cost $${cost} exceeds --max-cost $${maxCost}. Re-run with --max-cost ${cost} to allow it.`);
    }

    // 2. Real generation.
    const j = await api("/inferences", payload, key);
    const imgs = j.base64_images || [];
    if (!imgs.length) die(`No images returned: ${JSON.stringify(j).slice(0, 300)}`);

    const name = a.name || `${payload.prompt_style}-${Date.now()}`;
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    imgs.forEach((b64, i) => {
      const buf = Buffer.from(b64, "base64");
      const ext = buf.slice(0, 3).toString("latin1") === "GIF" ? "gif" : "png";  // sniff magic bytes
      writeFileSync(join(dir, `${i}.${ext}`), buf);
    });
    writeFileSync(join(dir, "meta.json"), JSON.stringify({
      ...payload,
      balance_cost: j.balance_cost,
      remaining_balance: j.remaining_balance,
      model: j.model,
      created_at: j.created_at,
    }, null, 2));
    console.log(`✓ saved ${imgs.length} image(s) to tools/retrodiffusion/out/${name}/`);
    console.log(`  billed $${j.balance_cost}   remaining balance $${j.remaining_balance}`);
    return;
  }

  console.log(`RetroDiffusion asset generator
Commands:
  balance                                 show credits + $ balance
  cost  --style S --size N --n K --prompt "..."      free price quote
  gen   --style S --size N --n K --prompt "..."      generate (dry-runs first, guarded by --max-cost, default 0.05)
Flags: --seed N  --width N  --height N  --tile  --nobg  --name NAME  --max-cost 0.08`);
}

main().catch((e) => die(e.stack || String(e)));
