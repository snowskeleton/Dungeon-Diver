# game-2 — Developer Notes

2D top-down co-op game (classic Zelda style). Phaser 3 client + Colyseus authoritative server, TypeScript throughout. Everything is plain text files — no GUI editors, no scene builders.

## Deep-dive docs — read the matching one before touching that system

| File | Read when |
|---|---|
| [docs/animation.md](docs/animation.md) | Touching character sprites, attack/hurt visuals, or the `attackSeq` path |
| [docs/weapons-and-ammo.md](docs/weapons-and-ammo.md) | Touching weapons, attack FX, ammo, or projectiles |
| [docs/loadout.md](docs/loadout.md) | Touching inventory, weapon switching, shops, or pause |
| [docs/enemies.md](docs/enemies.md) | Adding or balancing an enemy |
| [docs/assets.md](docs/assets.md) | Adding or replacing art |
| [docs/lessons.md](docs/lessons.md) | Building a debug tool, a tunables panel, or a persistent weapon sprite |

`roadmap.html` at the project root is the living design document (phases, asset checklist, open questions).

## Running

```bash
npm run dev          # starts client (localhost:5173) + server (localhost:2567) concurrently
```

Both are defined in `.claude/launch.json` for the preview panel. The Colyseus server must be running for the client to do anything (it connects on load).

**Package manager: npm workspaces** (pnpm is broken on this machine — broken symlinks from an old Node install).

**Edit `shared/src/`, never `shared/dist/`.** The `shared` package's `package.json` sets `"main": "src/index.ts"`, so both the server (`ts-node-dev`) and the client (Vite alias) import the raw TypeScript source — nothing loads compiled output. `shared/dist/` is `.gitignore`d and only appears if you run `npm run build`; if it's present it's stale and editing it does nothing (a real gotcha — changing a `shared/dist/*.js` constant has zero effect). Note: `ts-node-dev` sometimes doesn't watch the symlinked `shared` workspace, so if a `shared/src` edit doesn't take, restart `npm run dev`. (A production `node dist/index.js` server run currently can't resolve `shared` at all since `main` is a `.ts` file — a deferred prod-build concern.)

**After replacing any PNG in `assets/`, run `npm run assets:build`** or the client keeps loading the old copy. See [docs/assets.md](docs/assets.md).

## Project structure

```
shared/src/
  types.ts             ← tile IDs + TILE_PROPS, InputMessage, RoomType, and the few cross-cutting constants (SERVER_TICK_MS, KNOCKBACK_* scale/stun knobs, enemy-count formula, ENTITY_RADIUS/FOOT_OFFSET). Balance does NOT live here — see characters/, enemies/, weapons/, ammo/
  characters/          ← one CharacterConfig per class (Knight/Rogue/Ranger/Mage): id, name, maxHp, speed, defaultWeaponId; index.ts exports CHARACTER_REGISTRY. Weapon stats live in weapons/, not here
  enemies/             ← one EnemyConfig per enemy (GooGreen/GooBlue/GooGold/Bat): hp/speed/aggro/attack/knockback stats; index.ts exports ENEMY_REGISTRY
  weapons/             ← one Weapon per <category>/<id>/index.ts (+ <id>.png icon); category base.ts holds defaults; index.ts exports WEAPON_REGISTRY + WeaponId union. Each weapon carries its own fxType; ranged ones carry ammoId + rangedStyle
  ammo/                ← projectiles ranged weapons spawn; mirrors weapons/ layout. Behaviour-sharing groups nest under a category base (arrows/, boomerangs/); one-offs (throwing-knife, throwing-star) sit flat. index.ts exports AMMO_REGISTRY + AmmoId union
  debug.ts             ← DebugConfig (the Debug menu's flat settings object) + DEFAULT_DEBUG_CONFIG + toDungeonOptions()
  dungeonGenerator.ts  ← seeded dungeon generation: generateDungeon(seed, opts?) builds a 5×4 grid of 21×16-tile rooms (105×64 tiles total), room graph, type assignment, tile carving, connections/barriers. `opts: DungeonOptions` overrides grid size, forced room type, boss, stairs
  tileData.ts          ← exports MAP_SEED + MAP_DATA = generateDungeon(MAP_SEED), plus spawn/room-center helpers
  index.ts             ← the "shared" package surface (client's Vite aliases `shared` → this file)

server/src/
  index.ts                  ← Colyseus Server setup (http + ws on port 2567)
  rooms/GameRoom.ts         ← main 20 Hz game loop; owns the PhysicsWorld; join/leave/input/melee+projectile/AI tick, per-room enemy spawning, shop rolling, floor advancement (stairs → seed+1)
  floor/FloorManager.ts     ← barrier/door system: locks rooms on entry, unlocks on clear, pre-clears empty rooms
  physics/PhysicsWorld.ts   ← the ONLY file that touches matter-js: engine, wall bodies, collision categories/COLLIDE toggles, px/sec↔matter velocity conversion, sprite-center↔foot-body coordinate mapping
  entities/Entity.ts        ← base class: move() records velocity intent (physics resolves walls/separation), applyTileEffects(), takeDamage(), teleport() — shared by Player + Enemy
  entities/Player.ts        ← extends Entity; looks up its CharacterConfig from CHARACTER_REGISTRY; applyInput(), getAttackHitbox(), hitsEnemy(), justAttacked flag + getShotAngle() for ranged fire. Owns the weapon inventory
  entities/Enemy.ts         ← abstract base; tick() runs AI state machine (patrol/chase/attack), knockback + hitstun (overage threshold; stun suspends AI), death
  entities/Goo.ts           ← the ONE concrete enemy class: takes any EnemyType, pulls its EnemyConfig from ENEMY_REGISTRY, overrides updateFacing() for horizontal-only art (bats spawn as Goo too)
  entities/Projectile.ts    ← kinematic arrow/thrown-weapon (no matter-js body); integrates position, swept ellipse-vs-enemy hits, pierce, boomerang return, wall/lifetime despawn. Pulls its AmmoConfig from AMMO_REGISTRY
  schema/EntityState.ts     ← Colyseus schema base (x, y, health, speedMultiplier)
  schema/PlayerState.ts     ← extends EntityState (facing, isAttacking, attackSeq, characterClass, characterType, weaponId=active, inventory[], activeWeaponIndex)
  schema/EnemyState.ts      ← extends EntityState (aiState, targetId, facing, isDying, stunned, enemyType)
  schema/ProjectileState.ts ← extends EntityState (angle, ammoId, ownerSessionId)
  schema/ShopState.ts       ← ShopItemState (weaponId, cost, purchased, x/y pedestal pos) + ShopState (roomId, items[])
  schema/GameState.ts       ← root schema: MapSchema of players + enemies + projectiles + shops (keyed by room id), floor number, `paused` flag

client/src/
  main.ts                   ← Phaser.Game config (800×576, pixelArt, WebGL); scene list [MenuScene, GameScene] — MenuScene auto-starts. Dev-only placeholder-asset report + `window.__game`
  launch.ts                 ← LaunchConfig (what MenuScene hands GameScene: debug config + P1 loadout) and pickLoadout() = character picker → weapon picker
  scenes/MenuScene.ts       ← title screen: Start / Options / Debug. Start and Debug both run pickLoadout() then `scene.start("GameScene", config)`
  scenes/GameScene.ts       ← main scene; init(LaunchConfig) resets per-run state, async create() connects to server, wires state sync (players/enemies/projectiles/shops) + floor-change/barrier messages, room-locked camera. Owns the inventory HUD, PAUSED overlay, and P1 store card. Esc → menu
  characters/index.ts       ← CLIENT_CHARACTER_VISUAL_REGISTRY (CharacterType → preload/defineAnimations/spriteConfig)
  enemies/index.ts          ← CLIENT_ENEMY_REGISTRY (display names)
  weapons/index.ts          ← CLIENT_WEAPON_REGISTRY (name + placeholder-art flag; feeds PlaceholderReport)
  entities/Entity.ts        ← base Phaser class: rectangle anchor + HP bar; setupCharacter()/playAnim() for registry-driven characters, useRawSprite() for self-animating sprites (enemies), attack FX with per-frame weapon icon tracking
  entities/SpriteClips.ts   ← shared clip-definition helpers used by the Humanoid/Goo/Bat sprite modules
  entities/HumanoidSprites.ts ← shared 15-col × 4-row humanoid sheet layout, clip definitions, makeHumanoidSpriteConfig()
  entities/AttackFXSprites.ts ← one-shot slash/stab FX strips, rotated per facing
  entities/RangedWeaponFX.ts ← "held" ranged draw: 2-frame bow/crossbow sheet played 0→1→0→0 beside the player, rotated to fire direction
  entities/ProjectileEntity.ts ← lightweight (no HP bar) projectile view; lerps to server pos, points along angle or spins per AmmoConfig
  entities/GooSprites.ts    ← goo clips (6-frame cycle; death = same frames reversed) + isGooType()
  entities/BatSprites.ts    ← bat clips (16×16 frames displayed at 32×32) + isBatType()
  entities/LocalPlayer.ts   ← extends Entity; reads InputSource, sends to server, hp field for HUD. Weapon-swap on active change, cycle/menu/buy actions, shop proximity, acquire-diff → AcquireFX + input freeze
  entities/RemotePlayer.ts  ← extends Entity; lerps toward server position, drives anim from server's facing/isAttacking/attackSeq + inferred movement; swaps weapon visuals on weaponId change
  entities/EnemyEntity.ts   ← extends Entity; lerps toward server position, plays goo/bat clips from enemyType/isDying
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

**Data-driven content (registries, not classes)**: all gameplay stats live in plain config objects in `shared/` — `CHARACTER_REGISTRY` (per-class maxHp/speed/defaultWeaponId), `ENEMY_REGISTRY` (per-enemy stats), `WEAPON_REGISTRY` (damage/cooldown/force/`getHurtbox` geometry/`fxType`), `AMMO_REGISTRY` (projectile stats). Server entities (`Player`, `Goo`, `Projectile`) look up their config by id; client visuals live in parallel registries (`client/src/characters`, `client/src/enemies`, `client/src/weapons`). Clients pass `characterClass`/`characterType` as join options; both are synced on `PlayerState` so remote clients render the right skin. **Add content by adding a config + registry entry, not a class.**

**Loadout system** (inventory, switching, shops, pause) is server-authoritative and synced. Switching is an instant hotkey; the inventory menu pauses the whole room; the store is an in-world room and does *not* pause. See [docs/loadout.md](docs/loadout.md).

**Menus and debug floors**: `MenuScene` is the boot scene (Start / Options / Debug). All three paths end in `scene.start("GameScene", LaunchConfig)`, where `LaunchConfig.debug` is either `null` (real game) or a `DebugConfig`. The client passes that config as a Colyseus join option; `GameRoom.onCreate` turns it into `DungeonOptions` and stores the JSON in `GameState.dungeonOpts` so every client (including late joiners) generates the same map the server did. Debug rooms use `client.create()` rather than `joinOrCreate()` so they never matchmake into a room built with different options; P2–P4 then `joinById()`.

To add a debug knob: add the property to `DebugConfig` (`shared/src/debug.ts`) with a default, add one entry to `DEBUG_FIELDS` (`client/src/debug/debugFields.ts`), and read it in `GameRoom` (or map it into `DungeonOptions`). The panel renders itself from the field list — `FieldPanel.ts` never needs touching. `GameScene` and `MenuScene` are restartable, so anything they mutate is reset in `init()`/`create()`, not at field-initializer time.

**Room type system**: `dungeonGenerator.ts` assigns a `RoomType` (`"combat" | "maze" | "boss" | "shop" | "shrine"`) to each room during generation — before carving, so the carve function varies by type. Boss is placed first (random non-start room), then all others get a weighted roll (58% combat / 17% maze / 17% shop / 8% shrine). `RoomData.type` carries the type through to `GameRoom`, which uses it to decide enemy spawning (skips boss/shop/shrine). Boss passageway tiles are overwritten with `TILE.BOSS_FLOOR` (gold, breathing animation) after connections are built.

**Empty room finalization**: after `spawnFloorEnemies()`, `GameRoom` calls `floorManager.finalizeEmptyRooms()`, which marks all zero-enemy rooms as pre-cleared and removes their outgoing `barrierParent` barriers. Without this, boss/shop/shrine rooms lock the player in forever (no enemies to kill = clear condition never fires). Also, `FloorManager.checkPlayerEnteredRoom()` skips placing `barrierChild` for any room with no enemies — players can always retreat from empty rooms.

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
| Weapon (damage, cooldown, force, swing geometry, fxType) | `shared/src/weapons/<category>/<id>/index.ts` (or category `base.ts`) |
| Ammo/projectile (damage, speed, pierce, hit ellipse, spin/return) | `shared/src/ammo/<id>/index.ts` |
| Enemy (hp, speed, aggro, attack, knockback resistance) | `shared/src/enemies/<Name>.ts` |
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

### Add a new entity type (e.g. NPC, boss)
1. `server/src/schema/` — new schema extending `EntityState`
2. `server/src/entities/` — new class extending `Entity`; override `tick()` for AI
3. Add schema field to `GameState.ts` (`MapSchema<NewState>`)
4. Spawn from `GameRoom` (see `spawnFloorEnemies()`/`initFloor()` for the flow), tick in `GameRoom.tick()`
5. `client/src/entities/` — new class extending `Entity`
6. Wire up `onAdd`/`onRemove`/`onChange` in `GameScene.setupWorldSync()`

### Add a player ability / game mechanic
- Server: add input fields to `InputMessage` in `shared/src/types.ts`
- Server: handle in `Player.applyInput()` or `GameRoom.tick()`
- Client: add key/button to `InputSource` implementations; send in the input message
- State changes go in the relevant Schema class and get auto-synced by Colyseus

### Add a new room type (e.g. lobby, dungeon level)
Define a new `Room` subclass in `server/src/rooms/`, register it in `server/src/index.ts` with `gameServer.define()`, and connect to it by name from the client via `client.joinOrCreate("room-name")`.

## Gotchas

- **Tile coordinates vs pixel coordinates**: tiles are 32×32 px. `entity.state.x/y` are pixel coords. To get tile: `Math.floor(x / TILE_SIZE)`. Spawn points are set as `col * TILE_SIZE + 16` (center of tile).
- **Server physics is matter-js** (`server/src/physics/PhysicsWorld.ts` — the only file that imports it). Each entity is a radius-5 circle at the sprite's *feet* (`body.y = state.y + FOOT_OFFSET(8)`); schema `state.x/y` stays the sprite center. (`ENTITY_RADIUS`/`FOOT_OFFSET` are defined in `shared/src/types.ts` and re-exported from PhysicsWorld, so the client **H** debug overlay can draw the true collision circle.) Movement: `Entity.move()` records px/sec intent → GameRoom calls `commitVelocity()` (converts px/sec ÷ 60 to Matter's per-16.667ms velocity units — get this wrong and everything moves ~3× off) → `Engine.update(50)` → `syncFromBody()`. Who-collides-with-whom is the `COLLIDE` table in PhysicsWorld (currently all pairs on). `ENTITY_RADIUS` must stay ≤ ~14 or one-tile 32px gaps close. Melee `attackRadius` values in enemy configs are center-to-center and must exceed `2 × ENTITY_RADIUS` (10px) or attacks silently never land against rigid separation — that's why the goo configs use `attackRadius: 14`. Dying enemies get a WALL-only collision mask via `setEntityDead()` (corpses don't block). All teleports go through `Entity.teleport()` (never assign `state.x/y` for position changes — the body won't follow).
- **Enemies stay dead — there is no respawn.** Cleared rooms stay cleared; everything is wiped and respawned fresh only when `advanceFloor()` regenerates the floor. Details in [docs/enemies.md](docs/enemies.md).
- **Camera is room-locked (Zelda-style)**: every frame, `GameScene.update()` snaps `camera.setBounds()` to the 21×16-tile room containing the local players' centroid, at 2× zoom, then `centerOn(centroid)`. Crossing a doorway hard-cuts the camera to the next room. Split-screen for spread-out local players is still an open idea.
- **No persistence**: all state is in-memory. Server restart = everyone disconnects and rejoins fresh.
