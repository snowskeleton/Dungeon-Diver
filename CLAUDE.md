# game-2 — Developer Notes

2D top-down co-op game (classic Zelda style). Phaser 3 client + Colyseus authoritative server, TypeScript throughout. Everything is plain text files — no GUI editors, no scene builders.

## Engineering approach — read this first

Build this project **MIT-style, not New Jersey-style**: correctness and a clean, complete design beat implementation-simplicity shortcuts. Do the hard thing right even if it takes longer. If you catch yourself reaching for a quick hack because the correct version is more work, stop and do the correct version. Placeholders are fine **only if they're functional real code** (a new enemy inheriting basic chase, a boss with one working ability) — never a fake or dead abstraction.

Concretely, and non-negotiably:
- **Enemies and their behavior are object-oriented.** Every enemy is its own class extending `Enemy`; its stats and behavior are defined *in that class* and compiler-checked. There is **no** generic "one enemy class configured by data" and **no lookup tables** that map an id to behavior or config. Shared behavior (chase, patrol, a volley) is a reusable method or a function the class calls — not a config flag or a `Record<Id, …>`. Bosses are `Boss` subclasses, one per boss.
- **Don't optimize for a hypothetical non-coding "designer."** We are the designers and we edit code directly. Put values where the compiler checks them and where they're cohesive (on the class), not in a stringly-keyed registry justified by imaginary tooling.
- **Prefer explicit, type-checked code over dynamic dispatch on strings.** A `switch` the compiler can exhaustively check, or direct class references in an array, beat a keyed map every time.

### Code style

- **Don't cram more than two comma-separated things on one line.** A list/object/params with three or more items goes one item per line. Two or fewer may share a line — e.g. `holdRange(this.preferredRange, { speedScale: 0.5, slack: 60 })` is fine, but a config object with `windUpMs, recoverMs, cooldownMs, range` on one line is not. Applies to object literals, array literals, and parameter lists.

## Deep-dive docs — read the matching one before touching that system

| File | Read when |
|---|---|
| [docs/animation.md](docs/animation.md) | Touching character sprites, attack/hurt visuals, or the `attackSeq` path |
| [docs/weapons-and-ammo.md](docs/weapons-and-ammo.md) | Touching weapons, attack FX, ammo, or projectiles |
| [docs/loadout.md](docs/loadout.md) | Touching inventory, weapon switching, shops, or pause |
| [docs/enemies.md](docs/enemies.md) | Adding or balancing an enemy |
| [docs/bosses.md](docs/bosses.md) | Designing or building a boss moveset (per-boss abilities spec + bestiary text) |
| [docs/boss-implementation-plan.md](docs/boss-implementation-plan.md) | Sequencing the boss/layers build — what to implement in what order |
| [docs/layers.md](docs/layers.md) | Touching collision, projectile targeting, friendly fire, or hit resolution |
| [docs/assets.md](docs/assets.md) | Adding or replacing art |
| [docs/retrodiffusion.md](docs/retrodiffusion.md) | Generating new art with the RetroDiffusion AI (icons, ammo, props, tiles) |
| [docs/lessons.md](docs/lessons.md) | Building a debug tool, a tunables panel, or a persistent weapon sprite |

`roadmap.html` at the project root is the living design document (phases, asset checklist, open questions).

## Running

```bash
npm run dev          # starts client (localhost:5173) + server (localhost:2567) concurrently
```

Both are defined in `.claude/launch.json` for the preview panel. The Colyseus server must be running for the client to do anything (it connects on load).

**Ports are overridable** — the server reads `PORT` (default 2567) and the client reads `VITE_SERVER_PORT` (default 2567) for the ws URL it connects to. To run a second isolated instance alongside a running `npm run dev` (e.g. to verify a change without disturbing it): `PORT=3567 npm run dev --workspace=server` and `VITE_SERVER_PORT=3567 npm run dev --workspace=client -- --port 6173`.

**Package manager: npm workspaces** (pnpm is broken on this machine — broken symlinks from an old Node install).

**Edit `shared/src/`, never `shared/dist/`.** The `shared` package's `package.json` sets `"main": "src/index.ts"`, so both the server (`ts-node-dev`) and the client (Vite alias) import the raw TypeScript source — nothing loads compiled output. `shared/dist/` is `.gitignore`d and only appears if you run `npm run build`; if it's present it's stale and editing it does nothing (a real gotcha — changing a `shared/dist/*.js` constant has zero effect). Note: `ts-node-dev` sometimes doesn't watch the symlinked `shared` workspace, so if a `shared/src` edit doesn't take, restart `npm run dev`. (A production `node dist/index.js` server run currently can't resolve `shared` at all since `main` is a `.ts` file — a deferred prod-build concern.)

**After replacing any PNG in `assets/`, run `npm run assets:build`** or the client keeps loading the old copy. See [docs/assets.md](docs/assets.md).

## Project structure

```
shared/src/
  types.ts             ← tile IDs + TILE_PROPS, InputMessage, RoomType, and the few cross-cutting constants (SERVER_TICK_MS, KNOCKBACK_* scale/stun knobs, enemy-count formula, ENTITY_RADIUS/FOOT_OFFSET, FLYING_CRUISE_HEIGHT). Balance does NOT live here — see characters/, enemies/, weapons/, ammo/
  characters/          ← one CharacterConfig per class (Knight/Rogue/Ranger/Mage): id, name, maxHp, speed, defaultWeaponId; index.ts exports CHARACTER_REGISTRY. Weapon stats live in weapons/, not here. base.ts also holds the CharacterType union (12 humanoid skins)
  enemies/             ← just the EnemyType id union + EnemyFacingMode (base.ts). Enemies are OO classes on the SERVER (server/src/entities/enemies + /bosses) — there is NO EnemyConfig and NO ENEMY_REGISTRY (that data-driven design was abandoned; see the engineering note)
  combat/              ← Attack (damage/knockback/source payload) + HitShape geometry (rect/circle/segment/sweptEllipse + shapeHitsPoint). Shared so the client H-overlay can reuse shapes; the resolver itself is server-side
  weapons/             ← one Weapon per <category>/<id>/index.ts (+ <id>.png icon); category base.ts holds defaults; index.ts exports WEAPON_REGISTRY + WeaponId union. Each weapon carries its own fxType; ranged ones carry ammoId + rangedStyle; staves carry an `aoe` spec (the Mage's blast)
  ammo/                ← projectiles ranged weapons spawn; mirrors weapons/ layout. Behaviour-sharing groups nest under a category base (arrows/, boomerangs/); one-offs (throwing-knife, throwing-star) sit flat. index.ts exports AMMO_REGISTRY + AmmoId union
  debug.ts             ← DebugConfig (the Debug menu's flat settings object) + DEFAULT_DEBUG_CONFIG + toDungeonOptions()
  dungeonGenerator.ts  ← seeded dungeon generation: generateDungeon(seed, opts?) builds a 5×4 grid of 21×16-tile rooms (105×64 tiles total), room graph, type assignment, tile carving, connections/barriers. `opts: DungeonOptions` overrides grid size, forced room type, boss, stairs
  tileData.ts          ← exports MAP_SEED + MAP_DATA = generateDungeon(MAP_SEED), plus spawn/room-center helpers
  index.ts             ← the "shared" package surface (client's Vite aliases `shared` → this file)

server/src/
  index.ts                  ← Colyseus Server setup (http + ws on port 2567)
  rooms/GameRoom.ts         ← main 20 Hz game loop; owns the PhysicsWorld + CombatSystem; join/leave/input/AI tick, then drains every entity's queued effects into the one combat resolve, per-room enemy spawning, shop rolling, floor advancement (stairs → seed+1)
  floor/FloorManager.ts     ← barrier/door system: locks rooms on entry, unlocks on clear, pre-clears empty rooms
  physics/PhysicsWorld.ts   ← the ONLY file that touches matter-js: engine, wall bodies, per-body layer/solidMask collision filters (from each entity's InteractionProfile — see shared/src/layers.ts), px/sec↔matter velocity conversion, sprite-center↔foot-body coordinate mapping
  combat/                   ← the ONE combat resolver. CombatSystem.resolve() applies every HitSource ({shape, affects, attack, claim}) to every CombatTarget when affects&layer + shapes overlap + not-owner + claim passes → target.takeHit(Attack). RehitGate = per-target re-hit dedupe for lingering hitboxes. HitShape geometry + the Attack payload live in shared/src/combat
  spells/                   ← the unified ability system. Spell (windUp→strike→active→recover + cooldown it OWNS via isReady/markCast); SpellCaster runs the lifecycle (shared by bosses, enemies, players); Caster = the tiny interface a spell needs ({x,y,facing,attackAffects,emitHitSource,spawnProjectile}); builders.ts = volley/radial/tremorLine/dashAttack/whirl; weaponSpell.ts turns a Weapon into a swing / shot / AOE spell
  entities/Entity.ts        ← base class: move()/knockback/hitstun (overage threshold), takeHit(Attack), applyTileEffects(), teleport(), and the emitHitSource/spawnProjectile effect buffer GameRoom drains — shared by Player + Enemy
  entities/Player.ts        ← extends Entity, is a Caster; looks up its CharacterConfig; applyInput() drives a SpellCaster running the active weapon's Spell (swing/shot/AOE). Owns the weapon inventory
  entities/Enemy.ts         ← abstract base; default tick() = patrol/chase AI + contactHitSource() (touch damage as a hitbox); death. Stats are per-class getters, no config. Flying is one such getter: `cruiseHeight` (0 = grounded) — a flyer (bat, floater, wyvern) overrides it and the base tick keeps `state.airHeight` there each tick (a dive spell overrides it mid-cast); `setAirHeight()` lets a spell drive it. Collision stays at the ground point — height is purely visual
  entities/enemies/         ← the OO enemy classes (goos/bats/floaters/critters/directional), one Enemy subclass each; REGULAR_ENEMIES = the spawn-pool array (index.ts). No config, no ENEMY_REGISTRY
  entities/Boss.ts          ← abstract Boss (extends Enemy, is a DashCaster); picks the next Spell and delegates to a SpellCaster; deals no passive contact damage. entities/bosses/ = one Boss subclass each + movement.ts + BOSSES array
  entities/Projectile.ts    ← kinematic arrow/thrown-weapon (no matter-js body); integrates position, swept-ellipse hitSource(), pierce, boomerang return, wall/lifetime despawn. Pulls its AmmoConfig from AMMO_REGISTRY
  schema/EntityState.ts     ← Colyseus schema base (x, y, health, speedMultiplier)
  schema/PlayerState.ts     ← extends EntityState (facing, isAttacking, attackSeq, characterClass, characterType, weaponId=active, inventory[], activeWeaponIndex)
  schema/EnemyState.ts      ← extends EntityState (aiState, targetId, facing, isDying, stunned, enemyType, telegraph/channeling/abilityId for bosses, airHeight for flyers)
  schema/ProjectileState.ts ← extends EntityState (angle, ammoId, ownerSessionId)
  schema/ShopState.ts       ← ShopItemState (weaponId, cost, purchased, x/y pedestal pos) + ShopState (roomId, items[])
  schema/GameState.ts       ← root schema: MapSchema of players + enemies + projectiles + shops (keyed by room id), floor number, `paused` flag

client/src/
  main.ts                   ← Phaser.Game config (800×576, pixelArt, WebGL); scene list [MenuScene, GameScene] — MenuScene auto-starts. Dev-only placeholder-asset report + `window.__game`
  launch.ts                 ← LaunchConfig (what MenuScene hands GameScene: debug config + P1 loadout) and pickLoadout() = character picker → weapon picker
  scenes/MenuScene.ts       ← title screen: Start / Options / Debug. Start and Debug both run pickLoadout() then `scene.start("GameScene", config)`
  scenes/GameScene.ts       ← main scene; init(LaunchConfig) resets per-run state, async create() connects to server, wires state sync (players/enemies/projectiles/shops) + floor-change/barrier messages, room-locked camera. Owns the inventory HUD, PAUSED overlay, and P1 store card. Esc → menu
  characters/index.ts       ← CLIENT_CHARACTER_VISUAL_REGISTRY (CharacterType → preload/defineAnimations/spriteConfig)
  enemies/index.ts          ← CLIENT_ENEMY_REGISTRY: a thin `Record<EnemyType, ClientEnemyDef>` wiring table — each id maps to a named def imported from a group module. No definitions here; the annotation makes the compiler flag any id missing a def
  enemies/{goos,bats,floaters,critters,directional}.ts ← per-group visual defs (name + textureKey + displayW/H + `airborne?` + preload/defineAnimations/resolve()), mirroring the server's entities/enemies/*.ts grouping. Add an enemy by exporting its def here + one line in index.ts
  enemies/bosses/           ← one visual-def module per boss (TurtleDragon/Wyvern/TenguMask + simple.ts) — where the ability-driven row-swap closures live — plus factory.ts (the boss() 2×-size helper). Mirrors server entities/bosses/
  enemies/sheetEnemy.ts     ← makeSheetEnemyDef(): horizontal art (one side view, flipX for left). Handles multi-row sheets + non-square cells via explicit moveFrames
  enemies/directionalEnemy.ts ← makeDirectionalEnemyDef(): 4-row sheets, one row per facing (up/right/down/left), never mirrored
  weapons/index.ts          ← CLIENT_WEAPON_REGISTRY (name + placeholder-art flag; feeds PlaceholderReport)
  entities/Entity.ts        ← base Phaser class: rectangle anchor + HP bar; setupCharacter()/playAnim() for registry-driven characters, useRawSprite() for self-animating sprites (enemies), attack FX with per-frame weapon icon tracking
  entities/SpriteClips.ts   ← shared clip-definition helpers used by HumanoidSprites and the enemy sprite factories (client/src/enemies)
  entities/HumanoidSprites.ts ← shared 15-col × 4-row humanoid sheet layout, clip definitions, makeHumanoidSpriteConfig()
  entities/AttackFXSprites.ts ← one-shot slash/stab FX strips, rotated per facing
  entities/RangedWeaponFX.ts ← "held" ranged draw: 2-frame bow/crossbow sheet played 0→1→0→0 beside the player, rotated to fire direction
  entities/ProjectileEntity.ts ← lightweight (no HP bar) projectile view; lerps to server pos, points along angle or spins per AmmoConfig
  entities/LocalPlayer.ts   ← extends Entity; reads InputSource, sends to server, hp field for HUD. Weapon-swap on active change, cycle/menu/buy actions, shop proximity, acquire-diff → AcquireFX + input freeze
  entities/RemotePlayer.ts  ← extends Entity; lerps toward server position, drives anim from server's facing/isAttacking/attackSeq + inferred movement; swaps weapon visuals on weaponId change
  entities/EnemyEntity.ts   ← extends Entity; lerps toward server position; asks CLIENT_ENEMY_REGISTRY[enemyType].resolve(state) for the clip/static frame + whether to mirror. For `airborne` defs it lifts the sprite by the synced airHeight and scales a ground shadow beneath it
  entities/ShopItemEntity.ts ← in-world shop pedestal view (icon + HP-cost label); ghosts out when purchased. Not an Entity (no HP bar)
  entities/AcquireFX.ts     ← one-shot "item get!" flourish: weapon icon pops above the head + centered stats panel; fires on inventory growth
  input/InputSource.ts      ← interface + KeyboardInputSource (wasd/arrows) + GamepadInputSource. read()=movement/attack; readActions()=discrete intents (prev/next slot, toggle menu, interact/buy) edge-detected by LocalPlayer
  input/LocalPlayerManager.ts ← manages 1–4 local Colyseus connections; getCentroid() for camera
  ui/FieldPanel.ts          ← generic DOM settings panel rendered from a FieldSpec list (toggle/number/select/multiselect) + optional preset chips; backs both Options and Debug
  ui/CharacterPicker.ts     ← join-time class + skin chooser (DOM overlay), shown before the weapon picker
  ui/WeaponPicker.ts        ← join-time weapon chooser (DOM overlay)
  debug/debugFields.ts      ← DEBUG_FIELDS + DEBUG_PRESETS: the Debug menu as data. Add a knob here (and to shared DebugConfig); the panel renders itself
  options/gameOptions.ts    ← OPTION_FIELDS + localStorage-backed GameOptions (camera zoom, hitbox overlay, controls hint)
  ui/InventoryHud.ts        ← fixed HUD row of owned weapons, active slot highlighted (rebuilds only on change)
  ui/InventoryMenu.ts       ← pause menu (DOM overlay): owned weapons + expanded stats; opening it pauses the room
  ui/weaponStats.ts         ← weaponStatLines(weapon) → stat rows (ranged pulls ammo stats); shared by store card, acquire panel, inventory menu
  debug/HitboxDebug.ts      ← press H in-game: draws ALL hit/hurtboxes live. Each entity implements collectDebugShapes() from debug/DebugDraw.ts, so the overlay is generic
  debug/hurtboxShapes.ts    ← melee-swing hurtbox shapes, shared by LocalPlayer and RemotePlayer
  dev/PlaceholderReport.ts  ← dev-only: lists placeholder art in the console AND the npm-run-dev terminal (via terminalLogPlugin)
  map/TileRenderer.ts       ← buildMap() renders MAP_DATA from the dungeon-tiles.png tileset (TILE_TO_FRAME map); tweens fire/stairs/boss tiles; still generates the barrier texture programmatically
  public/sprites/           ← PNGs Phaser loads at runtime (copied by `npm run assets:build`)
```

## Key architectural decisions

**Authoritative server**: clients send `{ dx, dy, attack }` inputs; server computes all movement, collision, combat, and AI. Client only renders interpolated positions.

**One Colyseus connection per player** — even for same-screen co-op. P1 uses WASD+Space, P2 uses arrows+Enter, P3/P4 use gamepads. Press **P** in-game to add a local player. All connect to the same room.

**First player's room is the world observer**: `GameScene` uses `localPlayers[0].room.state` to watch all players + enemies and render remote entities. Enemies are never locally controlled.

**Async `create()` guard**: Phaser doesn't await async `create()`, so `update()` can run before setup is done. Guard: `private ready = false` set at end of `create()`; `update()` returns early if `!this.ready`.

**Tile system**: `shared/src/types.ts` defines `TILE_PROPS` keyed by tile ID. Server's `Entity.ts` reads these for walkability checks and tile effects. Client's `TileRenderer.ts` renders the same generated `MAP_DATA` using frames from the `dungeon-tiles.png` tileset — same data, no sync needed.

**Two content styles, on purpose.** *Inert* content — characters, weapons, ammo — is plain config in `shared/` registries: `CHARACTER_REGISTRY` (per-class maxHp/speed/defaultWeaponId), `WEAPON_REGISTRY` (damage/cooldown/force/`getHurtbox`/`fxType`/`aoe`), `AMMO_REGISTRY` (projectile stats). Add one by adding a config + registry entry. *Behavioural* content — **enemies and bosses** — is **object-oriented**: one `Enemy`/`Boss` subclass each (`server/src/entities/enemies` + `/bosses`), stats as compiler-checked getters, listed in `REGULAR_ENEMIES` / `BOSSES` arrays. There is **no** `ENEMY_REGISTRY` and no generic `Goo` — behaviour lives on the class, never in a data blob steered by a lookup table (see the engineering note). Client visuals live in parallel registries (`client/src/characters`, `client/src/enemies`, `client/src/weapons`). Clients pass `characterClass`/`characterType` as join options, synced on `PlayerState`.

**Unified combat + spells.** All damage flows through one resolver (`server/src/combat/CombatSystem`): entities emit `HitSource`s during their tick, and it delivers an `Attack` to any `CombatTarget` whose `layer` the source's `affects` mask reaches (directional — see `docs/layers.md`). All abilities are one `Spell` type (`server/src/spells`) run by a shared `SpellCaster` — a boss move, an enemy attack, and a player's weapon swing/shot/AOE are the same shape (windUp→strike→active→recover, cooldown owned by the spell). Anything that casts implements the tiny `Caster` interface. **Add an attack/ability as a `Spell`, not a bespoke code path.**

**Loadout system** (inventory, switching, shops, pause) is server-authoritative and synced. Switching is an instant hotkey; the inventory menu pauses the whole room; the store is an in-world room and does *not* pause. See [docs/loadout.md](docs/loadout.md).

**Menus and debug floors**: `MenuScene` is the boot scene (Start / Options / Debug). All three paths end in `scene.start("GameScene", LaunchConfig)`, where `LaunchConfig.debug` is either `null` (real game) or a `DebugConfig`. The client passes that config as a Colyseus join option; `GameRoom.onCreate` turns it into `DungeonOptions` and stores the JSON in `GameState.dungeonOpts` so every client (including late joiners) generates the same map the server did. Debug rooms use `client.create()` rather than `joinOrCreate()` so they never matchmake into a room built with different options; P2–P4 then `joinById()`.

To add a debug knob: add the property to `DebugConfig` (`shared/src/debug.ts`) with a default, add one entry to `DEBUG_FIELDS` (`client/src/debug/debugFields.ts`), and read it in `GameRoom` (or map it into `DungeonOptions`). The panel renders itself from the field list — `FieldPanel.ts` never needs touching. `GameScene` and `MenuScene` are restartable, so anything they mutate is reset in `init()`/`create()`, not at field-initializer time.

**Room type system**: `dungeonGenerator.ts` assigns a `RoomType` (`"combat" | "maze" | "boss" | "shop" | "shrine"`) to each room during generation — before carving, so the carve function varies by type. Boss is placed first (random non-start room), then all others get a weighted roll (58% combat / 17% maze / 17% shop / 8% shrine). `RoomData.type` carries the type through to `GameRoom`, which uses it to decide enemy spawning (shop/shrine get none; the boss room gets a single boss, not the usual rabble; **the start room never gets enemies** so players aren't jumped on load — the one exception is a degenerate single-room floor where start === exit). Boss passageway tiles are overwritten with `TILE.BOSS_FLOOR` (gold, breathing animation) after connections are built.

**Debug "showcase" floors**: picking a specific room type in the Debug menu with a 1×1 grid no longer builds a lone start-is-exit room. `toDungeonOptions` maps it to `DungeonOptions.showcaseRoomType`, and `generateDungeon` builds a fixed 3-room line — plain combat start → the chosen room → combat exit (with stairs) — so shop/shrine/boss rooms get tested with a real spawn point and a proper exit. A bigger grid still forces every room to the chosen type (`forceRoomType`) as before.

**Empty room finalization**: after `spawnFloorEnemies()`, `GameRoom` calls `floorManager.finalizeEmptyRooms()`, which marks all zero-enemy rooms as pre-cleared and removes their outgoing `barrierParent` barriers. Without this, shop/shrine rooms lock the player in forever (no enemies to kill = clear condition never fires). **`spawnBoss()` must run before `finalizeEmptyRooms()`** — it's called at the end of `spawnFloorEnemies()` for exactly that reason. Otherwise the boss room is pre-cleared and the boss never locks anyone in. Also, `FloorManager.checkPlayerEnteredRoom()` skips placing `barrierChild` for any room with no enemies — players can always retreat from empty rooms.

**Stairs are never covered**: the stairs go at the exit room's center tile, which is also where a shop lays its middle pedestal. Two rules keep them clear. `dungeonGenerator.ts` picks the exit room as the farthest room from start whose type is not in `STAIRS_AVOID_TYPES` (`shop`, `shrine`) — add any future prop-placing room type to that list. And `GameRoom.spawnShops()` nudges each pedestal to the nearest plain-`FLOOR` column on the center row, which covers the fallback case where a forced-room-type debug floor makes *every* room a shop. Also: when start === exit (a single-room floor) the player would spawn on top of the stairs and descend instantly, so `generateDungeon` steps the spawn to the nearest open tile.

**Schema imports**: Colyseus decorators (`Schema`, `MapSchema`, `type`) come from `@colyseus/schema`, NOT from `colyseus`. The umbrella `colyseus` package only exports `Room`, `Server`, etc.

**`skipLibCheck: true`** in both tsconfigs — Colyseus's own type declarations have internal errors.

## Colyseus state sync pattern

```ts
// In GameScene.setupWorldSync():
state.things.onAdd((thingState, id) => {
  const view = new ThingEntity(this, thingState.x, thingState.y);
  this.things.set(id, view);
  thingState.onChange(() => view.setTarget(thingState.x, thingState.y, thingState.health));
});
state.things.onRemove((_, id) => {
  this.things.get(id)?.destroy();
  this.things.delete(id);
});
```

Colyseus fires `onAdd` for items already in the map when the callback is registered, so this also handles initial state.

## Where balance lives

| Knob | File |
|---|---|
| Player/class (maxHp, speed, starting weapon) | `shared/src/characters/<Class>.ts` |
| Weapon (damage, cooldown, force, swing geometry, fxType, staff `aoe`) | `shared/src/weapons/<category>/<id>/index.ts` (or category `base.ts`) |
| Ammo/projectile (damage, speed, pierce, hit ellipse, spin/return) | `shared/src/ammo/<id>/index.ts` |
| Enemy (hp, speed, aggro, attack, knockback resistance, flying height) | stat getters on the `Enemy` subclass — `server/src/entities/enemies/<group>.ts` (a flyer overrides `cruiseHeight`) |
| Boss (moveset, movement, phases, stats) | the `Boss` subclass — `server/src/entities/bosses/<Name>.ts` (spells from `server/src/spells`) |
| Store (pedestal count, HP cost formula, buy radius) | `server/src/rooms/GameRoom.ts` |
| Loadout keybinds / acquire freeze | `client/src/input/InputSource.ts`, `ACQUIRE_MS` in `entities/AcquireFX.ts` |
| Knockback / hitstun feel, tick rate, enemy count, body geometry | `shared/src/types.ts` |
| Debug-menu knobs and presets | `client/src/debug/debugFields.ts` (+ `shared/src/debug.ts`) |
| Client options (camera zoom, overlays) | `client/src/options/gameOptions.ts` |

Ranged weapons control only fire rate + which `ammoId`; the projectile's damage/speed live on the ammo.

## How to change things

### Add a tile type
1. Add ID to `TILE` const in `shared/src/types.ts`
2. Add its `TileProps` to `TILE_PROPS` in the same file
3. Map it to a tileset frame in `TileRenderer.ts` → `TILE_TO_FRAME` (add the frame to `assets/dungeon-tiles.png` first if it needs new art, then `npm run assets:build`)
4. Emit the new ID from the carve logic in `shared/src/dungeonGenerator.ts`

### Change the map
The map is **generated, not hand-authored**: `generateDungeon(seed)` in `shared/src/dungeonGenerator.ts` builds a 5×4 grid of 21×16-tile rooms (105×64 tiles total) with a seeded RNG. Client and server both call it with the same seed, so they always agree — no map sync. To get a different floor-1 layout, change `MAP_SEED` in `shared/src/tileData.ts` (each stairs descent regenerates with `seed + 1`). To change the *structure* — room sizes, carve shapes, connection rules — edit `dungeonGenerator.ts` itself.

### Add an enemy, a weapon, or art
See [docs/enemies.md](docs/enemies.md), [docs/weapons-and-ammo.md](docs/weapons-and-ammo.md), [docs/assets.md](docs/assets.md). Use those recipes, not the generic entity steps below.

### Add a character class or character skin
Classes (gameplay) and character types (visuals) are separate axes, both picked as Colyseus join options:
- **New class** (stats + starting weapon): `shared/src/characters/<Class>.ts` with a `CharacterConfig` → add to the `CharacterClass` union in `base.ts` + `CHARACTER_REGISTRY` in `index.ts`. No client-side registry entry needed — attack FX comes from the weapon.
- **New skin** (spritesheet): drop a PNG following the 15×4 humanoid layout in `assets/`, run `npm run assets:build`, add to the `CharacterType` union (`shared/src/characters/base.ts`) and `CLIENT_CHARACTER_VISUAL_REGISTRY` — `GameScene` preloads/defines from the registry automatically.

### Add an enemy or a boss
Enemies and bosses are OO — see [docs/enemies.md](docs/enemies.md) (rank-and-file) and [docs/bosses.md](docs/bosses.md) (movesets). An enemy is an `Enemy` subclass in `server/src/entities/enemies/` + `REGULAR_ENEMIES`; a boss is a `Boss` subclass in `entities/bosses/` (moveset = `abilities(): Spell[]`) + `BOSSES`. No schema/GameState changes — both reuse `EnemyState`.

### Add a genuinely new entity type (e.g. an NPC, not an enemy/boss)
1. `server/src/schema/` — new schema extending `EntityState`
2. `server/src/entities/` — new class extending `Entity`; override `tick()` for behaviour
3. Add schema field to `GameState.ts` (`MapSchema<NewState>`)
4. Spawn from `GameRoom`, tick in `GameRoom.tick()`
5. `client/src/entities/` — new class extending the client `Entity`
6. Wire up `onAdd`/`onRemove`/`onChange` in `GameScene.setupWorldSync()`

### Add an attack / ability
Attacks are `Spell`s (`server/src/spells`), not bespoke code. A weapon's attack comes from `weaponSpell()` (swing / shot / AOE, keyed off the weapon config); a boss/enemy ability is a `Spell` from `builders.ts` (or a new builder). All are run by the shared `SpellCaster` and emit `HitSource`s / projectiles through the `Caster` interface. Only add an input field (`InputMessage` in `shared/src/types.ts`, handled in `Player.applyInput()`) for a genuinely new *control*, not a new attack.

### Add a new room type (e.g. lobby, dungeon level)
Define a new `Room` subclass in `server/src/rooms/`, register it in `server/src/index.ts` with `gameServer.define()`, and connect to it by name from the client via `client.joinOrCreate("room-name")`.

## Gotchas

- **Tile coordinates vs pixel coordinates**: tiles are 32×32 px. `entity.state.x/y` are pixel coords. To get tile: `Math.floor(x / TILE_SIZE)`. Spawn points are set as `col * TILE_SIZE + 16` (center of tile).
- **Server physics is matter-js** (`server/src/physics/PhysicsWorld.ts` — the only file that imports it). Each entity is a radius-5 circle at the sprite's *feet* (`body.y = state.y + FOOT_OFFSET(8)`); schema `state.x/y` stays the sprite center. (`ENTITY_RADIUS`/`FOOT_OFFSET` are defined in `shared/src/types.ts` and re-exported from PhysicsWorld, so the client **H** debug overlay can draw the true collision circle.) Movement: `Entity.move()` records px/sec intent → GameRoom calls `commitVelocity()` (converts px/sec ÷ 60 to Matter's per-16.667ms velocity units — get this wrong and everything moves ~3× off) → `Engine.update(50)` → `syncFromBody()`. Who-collides-with-whom is each body's `layer`/`solidMask` (from its `InteractionProfile` in `shared/src/layers.ts` — currently every body blocks WALL|PLAYER|ENEMY). `ENTITY_RADIUS` must stay ≤ ~14 or one-tile 32px gaps close. Melee `attackRadius` getters on enemy classes are center-to-center and must exceed `2 × ENTITY_RADIUS` (10px) or attacks silently never land against rigid separation — that's why the goos use `attackRadius: 14`. Dying enemies get a WALL-only collision mask via `setEntityDead()` (corpses don't block). All teleports go through `Entity.teleport()` (never assign `state.x/y` for position changes — the body won't follow).
- **Enemies stay dead — there is no respawn.** Cleared rooms stay cleared; everything is wiped and respawned fresh only when `advanceFloor()` regenerates the floor. Details in [docs/enemies.md](docs/enemies.md).
- **Camera is room-locked (Zelda-style)**: every frame, `GameScene.update()` snaps `camera.setBounds()` to the 21×16-tile room containing the local players' centroid, at 2× zoom, then `centerOn(centroid)`. Crossing a doorway hard-cuts the camera to the next room. Split-screen for spread-out local players is still an open idea.
- **No persistence**: all state is in-memory. Server restart = everyone disconnects and rejoins fresh.
