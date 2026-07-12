# Retro Diffusion API — reference (verified 2026-07)

Pixel art image generation API. Base URL: `https://api.retrodiffusion.ai/v1`
Auth: send header `X-RD-Token: <key>` on every request. Keys start with `rdpk-`.
Humans create keys at https://www.retrodiffusion.ai/app/devtools (max 5 per account).

Prefer MCP if available: `https://mcp.retrodiffusion.ai/mcp` (HTTP transport, header
`Authorization: Bearer <key>`). MCP setup guides for every client (Claude Code +
plugin, Cursor, VS Code, Windsurf, Claude Desktop) live at
https://github.com/Retro-Diffusion/retro-diffusion-mcp.

MCP tools (17): create_inference, estimate_inference_cost (free), start_inference_job +
get_inference_job (async jobs — recommended for animations and batches; success results
carry hosted output_urls, not base64), list_available_styles, list_available_models,
get_style_usage, list_edit_tools, run_edit_tool, estimate_edit_tool_cost (free),
create_user_style, update_user_style, delete_user_style, authenticate, get_balance,
get_service_status, logout. Tip: pass `upload_outputs=true` on create_inference to
receive hosted URLs instead of base64 payloads.

## Generate images

`POST /v1/inferences` (Content-Type: application/json)

Required: `prompt` (describe the SUBJECT only, never write "pixel art"; styling comes
from prompt_style), `prompt_style` (style id), `width` (int), `height` (int),
`num_images` (int).

Optional: `seed` (int, reproducible), `input_image` (base64 PNG, NO
`data:image/png;base64,` prefix, RGB without transparency) + `strength` (0-1, default
0.75), `reference_images` (array of base64, RD Pro styles only, up to 9),
`input_palette` (base64, constrains colors), `remove_bg` (bool, transparent output),
`tile_x`/`tile_y` (bool, seamless), `frames_duration` (4|6|8|10|12|16, animation
styles), `return_spritesheet` (bool, animations: PNG spritesheet instead of GIF),
`upscale_output_factor` (int, 1 = native pixel size), `bypass_prompt_expansion` (bool),
`include_downloadable_data` (bool), `check_cost` (bool, FREE dry run: returns price,
generates nothing, charges nothing), `async` (bool).

The `negative` field is a placeholder — current models ignore it.

Size limits: API validates 16×16 to 512×512, but each style enforces tighter limits
(current styles top out at 384×384) — use per-style limits below or from the selector.

Success response (sync; null fields omitted):
`{"created_at": "...", "balance_cost": 0.019, "base64_images": ["iVBORw0KGgo..."],
"model": "rd_fast", "remaining_balance": 100.75}`. base64_images are raw base64 PNG
(or GIF for animation styles). Add `"upload_outputs": true` for hosted `output_urls`.

## Async jobs (recommended for animations / bulk)

`POST /v1/inferences` with `"async": true` → `{"status": "accepted", "task_id": "..."}`.
Poll `GET /v1/inferences/tasks/{task_id}` (same token) every ~2s →
`{"status": "pending"|"running"|"succeeded"|"failed", "result": <sync-shape when
succeeded>, "error": {...} when failed}`.

## Style catalog (public styles)

**RD Pro** (highest quality, supports reference_images, $0.18/image): rd_pro__default,
painterly, fantasy, horror, scifi, simple, isometric, topdown, platformer, dungeon_map,
spritesheet, fps_weapon, typography (all 64-256px, batch≤4, refs≤9); hexagonal_tiles,
ui_panel, inventory_items (256×256 only); edit, pixelate (64-256px, INPUT_IMAGE_REQUIRED).

**RD Plus** (quality all-rounder): rd_plus__default, retro, watercolor, textured,
cartoon, ui_element, item_sheet, character_turnaround, environment, isometric,
isometric_asset, topdown_map, topdown_asset (64-384px, batch≤16); classic, skill_icon
(32-192px); low_res, mc_item, mc_texture (16-128px); topdown_item (16-96px).

**RD Fast** (fastest/cheapest): rd_fast__default (batch≤15), simple, detailed, retro,
game_asset, portrait, texture, ui, item_sheet, character_turnaround, no_style, 1_bit
(64-384px, batch≤16); low_res, mc_item, mc_texture (16-128px). (Selector may return
internal ids like `default:rd_flux` — both forms accepted.)

**RD Mini** (aliases routing to Plus/Fast low-res; response `model` shows routed model):
rd_mini__classic, skill_icon (32-192px); low_res, mc_item, mc_texture, fast_low_res,
fast_mc_item, fast_mc_texture (16-128px); topdown_item (16-96px) — all batch≤16. Good
for small low-poly assets (icons, top-down items/projectiles).

**Advanced animations** (INPUT_IMAGE_REQUIRED, 32-256px matching start frame, batch=1,
frames_duration supported, GIF output): rd_advanced_animation__walking, idle, jump,
crouch, attack, destroy, custom_action, subtle_motion.

**Animations** (prompt-driven, GIF output, batch=1 unless noted):
rd_animation__four_angle_walking (48×48), four_angle_walking_idle (48×48), small_sprites
(32×32, batch≤16), vfx (24-96px sq), any_animation (64×64, refs≤9), big_animation
(128×128, refs≤9), 8_dir_rotation (80×80, refs≤5), battle_sprites (64×64).

**Tilesets**: rd_tile__tileset (16-32px, batch=1), tileset_advanced (16-32px, batch=1,
extra_prompt + extra_input_image), single_tile (16-64px), tile_variation (16-128px,
INPUT_IMAGE_REQUIRED), tile_object (16-96px), scene_object (64-384px).

**User styles**: user__<name>_<id> (created via /v1/styles or My Styles page).

**Live discovery**: `GET /v1/styles/selector` (optional
`?model=rd_fast|rd_plus|rd_pro|rd_mini`,
`?tab=tab:image|tab:animation|tab:advanced-animation|tab:tileset`). Each item:
prompt_style, name, description, required_model, required_tab, min/max width/height,
max_number_of_images, require_input_image, supports_reference_images, example_prompt.

## Costs (USD per request; verify with check_cost — free)

- rd_fast: `max(0.015, (w*h+100000)/6000000) * num_images`
- rd_plus: `max(0.025, (w*h+50000)/2000000) * num_images`
- low-res styles (mc_*, low_res, classic, skill_icon, topdown_item, tile variants):
  `max(0.02, (w*h+13700)/600000) * num_images`
- rd_pro: `0.18 * num_images`
- rd_advanced_animation: 0.14 (custom_action, subtle_motion: 0.25)
- rd_animation: 0.07 (any_animation, 8_dir_rotation: 0.25)
- rd_tile__tileset(_advanced): 0.10

`GET /v1/inferences/credits` → `{"credits": 0, "balance": 100.75}`. Balance is prepaid
USD; charged before generation, auto-refunded on failure. Invalid token → 403.

## Canvas edit tools (post-processing; snake_case fields)

`GET /v1/edit/tools` → enabled tools with balance_cost, credit_cost, is_free,
requires_minimum_balance, max_input_size, api_fields (authoritative).
`POST /v1/edit/tools/{tool_id}` → run. `POST /v1/edit/tools/{tool_id}/estimate` →
validate + estimate without running.

Every request needs `input_image` (raw base64 or data URI) + optional `custom_id`.
Tools: image_edit ($0.18; prompt, seed?; input ≤256px), inpainting ($0.18; mask_image +
prompt, seed?, soft_inpaint?), outpainting ($0.18; expand_*≥1, prompt?, seed?,
soft_inpaint?), seam_tiling ($0.18; tile_x?/tile_y?, seam_width?, repair_window_size?,
seed?), background_remover ($0.01; transparency_threshold?, force_solid_pixels?),
color_style_transfer ($0.01; extra_input_image), color_reducer (free; color_count?,
dither_mode?, dither_strength?), palette_converter (free; input_palette, dither_mode?,
dither_strength?), k_centroid_downscale (free; width + height), pixel_correction (free),
rotate (free; rotation_degrees?).

dither_mode: none | bayer_2x2 | bayer_4x4 | bayer_8x8; dither_strength 0-100. Animated
GIF input supported by color_reducer, palette_converter, color_style_transfer,
k_centroid_downscale only. Free tools with requires_minimum_balance need balance ≥ $0.01.

Chain tools by feeding the first base64_images item (or base64-fetched output_urls) into
the next call as input_image.

## Custom styles (RD Pro reference-image template)

`POST /v1/styles` {name (required), description?, style_icon?, reference_images? (max 1
via API), reference_caption?, apply_prompt_fixer? (default true), llm_instructions?,
user_prompt_template? (must contain {prompt}), force_palette?, force_bg_removal?,
min_width? + min_height? (both, 64-256)} → 201 with prompt_style `user__<name>_<id>`.
PATCH /v1/styles/{id} (all optional). DELETE /v1/styles/{id} → {"deleted": true}.

## Status & errors

`GET /v1/status` (no auth) → per-model ok/status. Check before bulk runs.
Error shapes (handle both): `{"detail": {"code": "...", "message": "..."}}` and
`{"detail": [{"msg": "..."}]}`.
Codes: 400 invalid input / insufficient balance; 401 missing/invalid token; 403 no
access (also /credits); 404 not found/not owned; 410 deprecated; 422 validation; 429
rate limited (respect Retry-After); 500 temporary (retry w/ backoff, charges refunded).

## Agent best practices

1) Pick prompt_style (or GET /v1/styles/selector for live limits). 2) POST with
check_cost:true — free. 3) Generate. 4) Use async:true + poll for animations/bulk. 5)
Reuse seed to iterate on a composition; change only the prompt. 6) base64 images are raw
— never include a `data:` prefix. 7) Prompts describe subject; style handles pixel-art
rendering. 8) For a consistent character, generate once with RD Pro, then pass that
output as reference_images.
