# game-2 — Developer Notes

2D top-down co-op game (classic Zelda style). Phaser 3 client + Colyseus authoritative server, TypeScript throughout. All plain text files — no GUI editors, no scene builders.

## Engineering approach — read this first

Build **MIT-style, not New Jersey-style**: correctness and a clean, complete design beat implementation-simplicity shortcuts. If the correct version is more work, do the correct version. Placeholders are fine **only if they're functional real code** (a new enemy inheriting basic chase, a boss with one working ability) — never a dead abstraction.

**OO is enforced, not preferred. Game content is classes, never flat config.** Every kind of content — enemies, bosses, weapons, ammo, upgrades, characters — is a class hierarchy whose stats and behaviour are compiler-checked getters resolved up an `extends` chain, listed in a plain array of classes/instances (`REGULAR_ENEMIES` / `BOSSES` / `WEAPONS` / `AMMO_CLASSES` / `UPGRADES` / `CHARACTERS`). A flat `Config` object or a `Record<Id, Config>` "registry" describing what something *is* is **not allowed** — finding one is a bug to convert. There is **no** generic "one class configured by data" and **no** id→behavior/config lookup table; shared behavior (chase, patrol, a volley) is a reusable method or function the class calls, not a config flag.

**A string id may exist in exactly two places: on the Colyseus wire, and in the one typed resolver that turns that received primitive back into its object.** Colyseus serializes primitives, so an identity that crosses server→client (`weaponId`, `ammoId`, `enemyType`, `characterClass`, `upgradeId`) *must* travel as a string and be resolved on receipt — that string→object step is the network boundary and cannot be a direct reference. Contain it: each id-family has **one** resolver — `resolveWeapon`, `resolveAmmo`, `getCharacter`/`resolveCharacterClass`, `upgradeById`, and the client visual resolvers (`CLIENT_ENEMY_REGISTRY`, `CLIENT_CHARACTER_VISUAL_REGISTRY`, `ENEMY_SPRITE_GEOMETRY`) — each backed by a `Record<Union, …>` *derived from* the content array (every key is some class's `id: SomeId`, so a typo is a compile error at the class). These hold **real objects/defs** and are the client's half of the wire boundary — **not** id→config/behavior tables. **No `as SomeId` cast lives outside a resolver, and no id→object lookup is done inline** — the backing `Record` is private to its resolver. An id that never crosses the wire is **never a string**: a weapon holds its `ammo` template object, an `ArmedEnemy` holds its weapon object. Prefer explicit type-checked code (an exhaustive `switch`, direct class references in an array) over dynamic dispatch on strings. We are the designers and edit code directly — don't optimize for a hypothetical non-coding "designer."

**Runtime-composed content is sent as a descriptor, not a catalog id.** A weapon is a base template + an unbounded runtime mix of `WeaponMod`s ("Cold Broadsword of Vampirism"). The wire carries the client-relevant *slice* of the composed instance — the resolved stats plus `displayName`, `tint`, and mod labels (see `WeaponSlotState`) — so `weaponId` selects only the **base art**; the composed identity rides as data. The client renders that descriptor and never reconstructs the mods (behavior stays server-side). A modifier owns its own presentation (`namePrefix`/`nameSuffix`/`tint`) and any real effect (`lifestealPct`), so a new composed weapon needs no new id and no client change — only art primitives and mod behaviors are the (legitimately build-time) bounded palette.

### Code style

**Don't cram more than two comma-separated things on one line.** A list/object/param set with three or more items goes one item per line (applies to object literals, array literals, parameter lists). Two or fewer may share a line.

## Deep-dive docs — read the matching one before touching that system

| File | Read when |
|---|---|
| [docs/animation.md](docs/animation.md) | Character sprites, attack/hurt visuals, the `attackSeq` path, melee timing |
| [docs/weapons-and-ammo.md](docs/weapons-and-ammo.md) | Weapons, attack FX, ammo, projectiles |
| [docs/loadout.md](docs/loadout.md) | Inventory, weapon switching, shops, pause |
| [docs/lobby.md](docs/lobby.md) | Menus, room browser, lobby, matchmaking, pause menu |
| [docs/turn.md](docs/turn.md) | P2P connectivity: the STUN/TURN relay, ephemeral credentials, deploying coturn |
| [docs/upgrades.md](docs/upgrades.md) | Player stats, weapon modifiers, damage numbers, reward pedestals |
| [docs/enemies.md](docs/enemies.md) | Adding or balancing an enemy |
| [docs/pathfinding.md](docs/pathfinding.md) | Enemy chase movement, flow field, aggro/threat, flyer-vs-cover collision |
| [docs/bosses.md](docs/bosses.md) | Boss movesets (per-boss abilities spec + bestiary) |
| [docs/boss-implementation-plan.md](docs/boss-implementation-plan.md) | Sequencing the boss/layers build |
| [docs/layers.md](docs/layers.md) | Collision, projectile targeting, friendly fire, hit resolution |
| [docs/assets.md](docs/assets.md) | Adding/replacing art; the generated tileset (`dungeon-tiles.png`) |
| [docs/retrodiffusion.md](docs/retrodiffusion.md) | Generating new art with the RetroDiffusion AI |
| [docs/playtest-2026-07-20.md](docs/playtest-2026-07-20.md) | First external playtest notes |
| [docs/playtest-2026-07-27.md](docs/playtest-2026-07-27.md) | Second (solo) playtest notes |
| [docs/lessons.md](docs/lessons.md) | Building a debug tool, tunables panel, or persistent weapon sprite |

`roadmap.html` at the project root is the living design document (phases, asset checklist, open questions).

## Running

```bash
npm run dev          # client (localhost:5173) + server (localhost:2567) concurrently
```

Both are in `.claude/launch.json` for the preview panel. The server must be running or the client does nothing (it connects on load). **Ports are overridable**: server reads `PORT` (default 2567), client reads `VITE_SERVER_PORT` (default 2567). To run a second isolated instance alongside a running `npm run dev`: `PORT=3567 npm run dev --workspace=server` and `VITE_SERVER_PORT=3567 npm run dev --workspace=client -- --port 6173`.

**Package manager: npm workspaces** (pnpm is broken on this machine).

**Edit `shared/src/`, never `shared/dist/`.** The `shared` package's `main` is `src/index.ts`, so server (`ts-node-dev`) and client (Vite alias) both import raw TypeScript — nothing loads compiled output. `shared/dist/` is `.gitignore`d; if present it's stale and editing it does nothing. `ts-node-dev` sometimes doesn't watch the symlinked `shared` workspace — if a `shared/src` edit doesn't take, restart `npm run dev`.

## Tests

**Vitest, at the repo root.** One suite boots the real physics, entities, combat, directors, and GameRoom with no server and no browser.

```bash
npm test                 # the whole suite
npm run test:watch       # watch mode
npm run test:coverage    # + v8 coverage in coverage/
npx vitest run tests/server/combat-resolver.test.ts   # one file
```

Tests mirror the source: `tests/shared/`, `tests/server/`. Shared scaffolding in `tests/helpers/`:
- `helpers/world.ts` — flat map, real `PhysicsWorld`, and `arena()`, which runs the **exact** gather-and-resolve step `GameRoom.tick` runs. Use it for anything about damage. Also `swingUntilHit()` — melee swings genuinely wind up (leading FX frames are empty), so "attack once and assert" never works; hold the attack across ticks.
- `helpers/gameRoom.ts` — `createRoom()` / `startedRoom()` drive a REAL `GameRoom` with only Colyseus's transport stubbed.

**Assert behaviour and relationships, never balance numbers.** `15 damage through 7 armor lands as 8` survives a retune; `a broadsword deals 20` does not. Where a shipping value is unavoidable, derive it (`WEAPON_REGISTRY[...].damage`). Two deliberate exceptions, both contracts not tuning: the **dungeon map checksum** (`tests/shared/dungeon.test.ts` — client and server generate from the same seed, so a change in rng draw ORDER silently changes every map and can desync; a deliberate generation change means re-running and pasting the new value), and tests named **`BUG:`** (pin known-broken behaviour with the cause in a comment; fixing one means rewriting its test).

**After replacing any PNG in `assets/`, run `npm run assets:build`** or the client keeps the old copy.

## Project structure

One clause per file; open the matching doc above for the deep detail.

```
shared/src/
  types.ts             ← tile IDs + TILE_PROPS, InputMessage, RoomType, cross-cutting constants (SERVER_TICK_MS, KNOCKBACK_*, enemy-count formula, ENTITY_RADIUS/FOOT_OFFSET, FLYING_CRUISE_HEIGHT, combo/charge defaults). Balance does NOT live here
  characters/          ← Character base (stats as getters) → one class per class (Knight/Rogue/Ranger/Mage), each overriding id/name/maxHp/speed/usableCategories (the weapon CATEGORIES it may wield). index.ts exports CHARACTERS + CHARACTER_CLASSES + getCharacter + the query helpers derived from usableCategories + resolveCharacterClass/resolveCharacterType (validators every client-supplied id passes through). base.ts holds CHARACTER_TYPES (12 skins) with the union derived from it. Players spawn with NO weapon
  enemies/             ← just the EnemyType union + EnemyFacingMode. Enemy classes live server-side
  combat/              ← Attack payload + HitShape geometry (shapeHitsPoint/shapeHitsBox). Shared so the client H-overlay reuses shapes; resolver is server-side
  upgrades.ts          ← UpgradeId union + UPGRADE_IDS + UpgradeSlotView. Upgrade CLASSES are server-side
  weapons/             ← Weapon base → category base (Sword/Bow/Staff/…) → one class per weapon in <category>/<id>/index.ts (+ icon). index.ts exports WEAPONS (the rollable PLAYER catalog) + WeaponId union. enemy/index.ts = ENEMY_WEAPONS: enemy-only armaments (what ArmedEnemies swing) — same category bases so they share fxType/hurtbox/icon (via an iconPath override reusing a catalog PNG), but kept OUT of WEAPONS so they never roll as loot. WEAPON_REGISTRY is the id→template lookup derived from BOTH (both are wire-referenced by id: server weaponSpell + client held-weapon visual resolve either). instance.ts = WeaponInstance/WeaponMod + WeaponSlotView; views.ts = adapters. Ranged weapons override ammoId + rangedStyle (staves cast an elemental bolt)
  ammo/                ← Ammo base → category base (Arrow/Bolt/Boomerang) → concrete ammo. index.ts exports AMMO_CLASSES + derived AMMO_REGISTRY + AmmoId union
  debug.ts             ← DebugConfig + DEFAULT_DEBUG_CONFIG + toDungeonOptions()
  economy.ts           ← run economy as DERIVED constants: shared party gold purse, per-floor BUDGETED gold split by goldWeight, fixed tier costs. No id→gold table
  lobby.ts             ← lobby/matchmaking layer: RunPhase, create/join options, RoomMetadata, message payloads, room-code alphabet
  stateViews.ts        ← the synced shape of every schema as read-only interfaces; server schemas `implements` these so a renamed @type field is a compile error. SYNCED FIELDS ONLY
  dungeonGenerator.ts  ← generateDungeon(seed, opts?): 5×4 grid of 21×16-tile rooms, room graph, type assignment, carving, connections/barriers
  tileData.ts          ← MAP_SEED + MAP_DATA + spawn/room-center helpers
  index.ts             ← the "shared" package surface (client Vite alias)

server/src/
  index.ts                  ← Colyseus Server (http+ws :2567) + GET /api/rooms/by-code/:code (the only way to reach a PRIVATE room)
  rooms/roomCodes.ts        ← allocate a collision-free 4-char join code; resolve it back via matchMaker.query
  rooms/GameRoom.ts         ← main 20 Hz loop; owns PhysicsWorld + CombatSystem + the two directors; join/leave/input/AI tick → one combat resolve, challenge plumbing, floor advancement (stairs → seed+1). Keep loot/spawning OUT of here
  rooms/LootDirector.ts     ← everything reward-shaped: shops, offers, room-clear pedestals, maze chests, the rolls, and validate-then-grant for buy/offerPick/claimReward/chestOpen
  rooms/SpawnDirector.ts    ← everything that puts a creature on the floor: rabble pass, boss, summons, enemy pool + count. One private addEnemy() is the only spawn choke point
  floor/FloorManager.ts     ← barrier/door system: lock on entry, unlock on clear, pre-clear empty rooms
  physics/PhysicsWorld.ts   ← the ONLY file that touches matter-js: engine, walls, per-body layer/solidMask filters, px/sec↔matter conversion, sprite-center↔foot-body mapping
  pathfinding/FlowFieldSystem.ts ← once/tick BFS-flood a distance field toward players; enemies follow the gradient. See docs/pathfinding.md
  combat/                   ← the ONE resolver: CombatSystem.resolve() applies each HitSource to each CombatTarget when affects&layer + shape overlaps hurtBounds + not-owner + claim passes → takeHit(Attack). Returns HitEvent[] broadcast as `hits`. RehitGate = per-target re-hit dedupe
  spells/                   ← the unified ability system. Spell (windUp→strike→active→recover + owned cooldown); SpellCaster runs the lifecycle (bosses, enemies, players); Caster = the tiny interface a spell needs; builders.ts = volley/radial/tremorLine/dashAttack/whirl; weaponSpell.ts turns a WeaponInstance into a swing/shot/AOE spell
  entities/Entity.ts        ← base: move()/knockback/hitstun, takeHit(Attack), applyTileEffects(), teleport(), the emitHitSource/spawnProjectile effect buffer GameRoom drains
  entities/Player.ts        ← extends Entity, is a Caster; holds its Character; applyInput() runs the active weapon's Spell. Owns weapons[] + upgrades[], folds them into its stats, and is the ONLY scaleAttack override
  entities/Enemy.ts         ← abstract base; default tick() = patrol/chase AI + contactHitSource() (touch damage as a hitbox); death. Stats are per-class getters. Flying is the cruiseHeight getter (0 = grounded); collision stays at the ground point, height is visual
  entities/enemies/         ← one file per enemy (PascalCase, like bosses/); REGULAR_ENEMIES + barrel in index.ts. Shared behaviour in its own files: CastingEnemy (caster lifecycle + no-contact default + aimAt), ApproachCastEnemy (close-in-then-commit tick), ArmedEnemy (weapon swing), DirectionalEnemy (row-per-facing), movement.ts (spiral/hop approaches)
  upgrades/                 ← Upgrade base (zero-returning stat getters + deferred spell() hook) + one class per upgrade in stats.ts + UPGRADES; weaponMods.ts = concrete WeaponMods a pedestal rolls
  entities/Boss.ts          ← abstract Boss (extends Enemy, is a DashCaster); picks the next Spell, delegates to a SpellCaster; no passive contact damage. entities/bosses/ = one class each + movement.ts + BOSSES
  entities/Projectile.ts    ← kinematic arrow/thrown weapon (no matter-js body); swept-ellipse hitSource(), pierce, boomerang return, despawn. Pulls AmmoConfig from AMMO_REGISTRY
  schema/*.ts               ← Colyseus schemas. EntityState (x,y,health,speedMultiplier) → PlayerState / EnemyState / ProjectileState; ShopState, OfferState, RewardState, ChestState, ShopItemState; GameState = root (MapSchemas of players/enemies/projectiles/shops/offers/rewards/supplies/chests/challenges/coins + floor + paused). See the "UNDECORATED field" gotcha for OfferChoiceState/RewardState/ChestState mods

client/src/
  main.ts                   ← Phaser.Game config (800×576, pixelArt, WebGL); scenes [MenuScene, BrowseScene, LobbyScene, GameScene]. Dev-only placeholder report + window.__game
  launch.ts                 ← pickLoadout() = the character picker (class + skin) only; run from the LOBBY. No weapon step — first weapon comes from the floor-1 supply room
  net/serverUrl.ts          ← the ws endpoint AND its matching http origin, resolved together
  net/Party.ts              ← the 1–4 connections this machine holds to one room; built in the LOBBY. Also listRooms()
  options/profile.ts        ← name + last-used loadout, persisted
  scenes/MenuScene.ts       ← title screen (Play Solo / Play Online / Options / Debug); all paths end in a lobby
  scenes/BrowseScene.ts     ← room browser: public list, join-by-code, host
  scenes/LobbyScene.ts      ← party staging; watches state.phase, starts GameScene on flip to "run"
  scenes/GameScene.ts       ← main scene; init resets per-run state, create() builds party views + state sync + floor/barrier messages, room-locked camera. Owns inventory HUD, PAUSED overlay, P1 store card, pause menu
  characters/index.ts       ← CLIENT_CHARACTER_VISUAL_REGISTRY (CharacterType → preload/defineAnimations/spriteConfig)
  enemies/index.ts          ← CLIENT_ENEMY_REGISTRY: thin Record<EnemyType, ClientEnemyDef> wiring table (compiler flags a missing def)
  enemies/<Name>.ts         ← one visual-def file per enemy, mirroring the per-enemy server files; shared directional shorthands (smallDirectionalDef/armedDirectionalDef) live in directionalEnemy.ts
  enemies/bosses/           ← one visual-def module per boss + factory.ts (boss() 2×-size helper)
  enemies/sheetEnemy.ts / directionalEnemy.ts ← the two def factories (horizontal-flip side view; 4-row per-facing sheet)
  enemies/spriteGeometry.ts ← Phaser-FREE table of cell size / frames / display size per EnemyType (the hurtbox generator imports it, so render + hit-test can't diverge)
  weapons/index.ts          ← CLIENT_WEAPON_REGISTRY (name + placeholder-art flag)
  entities/Entity.ts        ← base Phaser class: anchor + HP bar; setupCharacter()/playAnim(); useRawSprite() for self-animating enemies; attack FX with per-frame weapon-icon tracking
  entities/SpriteClips.ts / HumanoidSprites.ts ← shared humanoid 15×4 sheet layout + clip defs + makeHumanoidSpriteConfig()
  entities/WeaponVisuals.ts ← WeaponVisual interface + one class per style (Held/Bow/Staff/Nova/None) + factory. Entity holds ONE and calls sync/playAttack unconditionally — add a style as a class, never a nullable field. Every hand weapon is held in hand at rest; thrown weapons show nothing (the projectile is the visual)
  entities/AttackFXSprites.ts ← one-shot slash/stab FX strips, rotated per facing
  entities/HitFX.ts / SpawnFX.ts ← pooled one-shot sparks: HitFX per `hits` point; SpawnFX per enemies.onAdd (a dust puff on reveal)
  entities/RangedWeaponFX.ts / ProjectileEntity.ts ← held bow-draw sheet; lightweight projectile view
  entities/LocalPlayer.ts   ← extends Entity; reads InputSource, sends to server; weapon-swap/cycle/menu/buy, shop proximity, acquire-diff → AcquireFX + input freeze
  entities/RemotePlayer.ts  ← extends Entity; lerps to server pos, drives anim from facing/isAttacking/attackSeq; swaps weapon visuals on weaponId change
  entities/EnemyEntity.ts   ← extends Entity; lerps to server pos; CLIENT_ENEMY_REGISTRY resolve() picks clip/frame/mirror. airborne defs lift by synced airHeight + scale a ground shadow
  entities/ShopItemEntity.ts / OfferPedestalEntity.ts / RewardPedestalEntity.ts ← in-world pedestal views (not Entities, no HP bar); ghost out when claimed
  entities/AcquireFX.ts     ← one-shot "item get!" flourish; takes the synced SLOT so it shows ROLLED stats; fires on a new uid
  entities/InteractPrompt.ts ← world-space "press <key>" hint over any interactable
  input/InputSource.ts      ← interface + Keyboard/Gamepad sources. read()=movement/attack; readActions()=discrete intents edge-detected by LocalPlayer
  input/LocalPlayerManager.ts ← one LocalPlayer view per party member, input device by seat; getCentroid() for camera
  ui/FieldPanel.ts          ← generic DOM settings panel from a FieldSpec list; backs Options + Debug
  ui/CharacterPicker.ts     ← join-time class + skin chooser (the only loadout picker now)
  debug/debugFields.ts      ← DEBUG_FIELDS + DEBUG_PRESETS: the Debug menu as data
  options/gameOptions.ts    ← OPTION_FIELDS + localStorage GameOptions (zoom, overlays, combo/charge timings)
  options/keybindings.ts    ← rebindable key map + promptKeyLabel()
  ui/menuDom.ts             ← the ONE stylesheet + builders behind every full-screen DOM overlay
  ui/LobbyPanel.ts / RoomBrowserPanel.ts / PauseMenu.ts ← lobby view; browser view; pause menu
  ui/sceneBackdrop.ts       ← canvas behind a DOM menu scene
  ui/GameHud.ts             ← always-on screen furniture (party HP, floor line, PAUSED, P1 store card, controls hint) on the zoom-1 UI camera
  ui/InventoryHud.ts / InventoryMenu.ts ← owned-weapons HUD row; pause inventory menu (pauses the room)
  ui/weaponStats.ts / OfferPicker.ts ← weaponStatLines(); the 1-of-3 reward picker
  ui/ChallengeBanner.ts     ← renders state.challenges for the camera's room
  debug/HitboxDebug.ts / DebugDraw.ts / hurtboxShapes.ts ← press H: draws all hit/hurtboxes; each entity implements collectDebugShapes()
  dev/PlaceholderReport.ts  ← dev-only placeholder-art report (console + terminal)
  map/BarrierOverlays.ts    ← tiled images over locked doorways, keyed by connection id
  map/TileRenderer.ts       ← buildMap(): walls autotile off 8 neighbours (47-blob), floors pick a theme by room type + variant by hash, specials draw on top, cast shadows. See docs/assets.md
  map/tilesetFrames.generated.ts ← GENERATED frame table. Never hand-edit; `npm run assets:tiles`
  map/DarknessOverlay.ts    ← the entire "dark room" variant (client-only; see gotcha)
```

## Key architectural decisions

**Authoritative server**: clients send `{dx, dy, attack}`; server computes all movement, collision, combat, AI. Client only renders interpolated positions. First player's room is the world observer — `GameScene` uses `localPlayers[0].room.state`.

**Async `create()` guard**: Phaser doesn't await async `create()`, so `update()` can run before setup finishes. `private ready = false`, set at the end of `create()`; `update()` returns early if `!this.ready`.

**A room's lobby and its run are the same Colyseus room in two phases.** `GameState.phase` is `"lobby"` until the host starts, then `"run"` forever. Nothing simulates and no enemy exists in the lobby — `spawnFloorEnemies()` runs from `startRun()`, not the first join. "No dropping into a run in progress" is just `room.lock()` (a locked room is unlisted and unjoinable). Solo is a private room nobody can find. One Colyseus connection per player, even for same-screen co-op (P1 WASD+Space, P2 arrows+Enter, P3/P4 gamepads); press **P** in the lobby to add a couch player. See [docs/lobby.md](docs/lobby.md).

**Tile system**: `TILE_PROPS` in `shared/src/types.ts` is keyed by tile ID. Server's `Entity.ts` reads it for walkability + tile effects; client's `TileRenderer.ts` renders the same generated `MAP_DATA` — same data, no sync. **The tileset is generated CODE that samples real art**: `assets/generate-dungeon-tiles.js` builds both `assets/dungeon-tiles.png` and `client/src/map/tilesetFrames.generated.ts` in one run. Walls autotile (a raw 8-neighbour mask indexes a 256→frame lookup that collapses onto the 47-tile blob, complete by construction). **Never hand-paint the PNG — it is build output**; re-run with `npm run assets:tiles`. Full detail (floor flagstone scheme, stone sizes, block cover pieces, source sheet) is in [docs/assets.md](docs/assets.md).

**Unified combat + spells.** All damage flows through one resolver (`server/src/combat/CombatSystem`): entities emit `HitSource`s during their tick, it delivers an `Attack` to any `CombatTarget` whose `layer` the source's `affects` mask reaches (directional — see [docs/layers.md](docs/layers.md)). All abilities are one `Spell` type (`server/src/spells`) run by a shared `SpellCaster` — a boss move, an enemy attack, a player's swing/shot/AOE are the same shape. **Add an attack/ability as a `Spell`, not a bespoke code path.**

**Weapon instances + the attack pipeline.** `WEAPON_REGISTRY` entries are immutable **templates**; a player carries a `WeaponInstance` (template + uid + its own `WeaponMod[]`), so two players' broadswords can differ. Damage assembles in stages — template base → instance mods → **`Caster.scaleAttack`** → `Entity.takeHit` mitigation — never a literal. `Entity.scaleAttack` is identity, so **`Player` is the only override**; that's what lets one upgrade reach every weapon/ability/shot. Stats fold as `(base + Σflat) × (1 + Σpct)` so pickup order never matters. **Add a stat modifier as an `Upgrade` or `WeaponMod`, never by editing a damage number.** See [docs/upgrades.md](docs/upgrades.md).

**Melee hurtboxes are measured from the attack animation, not declared.** `assets/generate-fx-hurtboxes.js` reads the four FX strips and writes `shared/src/weapons/fxHurtboxes.generated.ts`; `Weapon.getHurtbox` derives from `fxType` (ranged/AOE → `() => null`), so **there is no per-weapon reach number to drift**. The hurtbox is **per-frame** (it sweeps outward; empty leading frames are a real ~143ms wind-up), and the swing arc's length is the melee spell's active phase with leftover cooldown spent before it as a cocked-back hold. Re-run the generator after changing any FX strip. See [docs/animation.md](docs/animation.md).

**Upgrades are OO, like enemies.** One `Upgrade` subclass each (`server/src/upgrades`), contributions as zero-default getters, listed in `UPGRADES`. The `UpgradeId` union lives in `shared`; `assertUpgradesCoverAllIds()` fails at boot if union and classes drift. Players hold them in `Player.upgrades` and fold them into their stats — **consumers ask the Player, they don't sum upgrades themselves**.

**Loadout system** (inventory, switching, shops, pause) is server-authoritative and synced. Switching is an instant hotkey; the inventory menu pauses the whole room; the store does not. See [docs/loadout.md](docs/loadout.md).

**Menus and debug floors**: `MenuScene` is the boot scene. All paths end in `scene.start("GameScene", LaunchConfig)`, where `LaunchConfig.debug` is `null` (real game) or a `DebugConfig` passed as a Colyseus join option; `GameRoom.onCreate` turns it into `DungeonOptions` and stores the JSON in `GameState.dungeonOpts` so every client generates the same map. Debug rooms use `client.create()` (never matchmake); P2–P4 `joinById()`. To add a debug knob: add the property to `DebugConfig` (`shared/src/debug.ts`) with a default, add one entry to `DEBUG_FIELDS` (`client/src/debug/debugFields.ts`), and read it in `GameRoom`. `GameScene`/`MenuScene` are restartable — reset mutated state in `init()`/`create()`, not at field-initializer time.

**Weapon access is class-restricted, declared on the class.** Each `Character.usableCategories` lists the categories it may wield (the four melee categories on every list; each class owns a few unique ones). No category→class table — `canClassUseWeapon`, `firstRollCategories`, `partyRollableWeaponIds` all derive from the per-class lists. `Player.canEquip` gates every weapon-granting path; an incompatible pickup grants nothing and returns a reason the GameRoom relays as `loot_error`. Loot rolls are filtered to what the present party can use. **Players spawn with no weapon** — first is claimed at the floor-1 supply room.

**Room types**: `dungeonGenerator.ts` assigns a `RoomType` per room before carving. The start room is always `"supply"` (cover-free, never populated; on floor 1 only it drops one weapon pedestal per player). Boss is placed first, then a weighted roll for the rest. Reward rooms in `NO_RABBLE_ROOM_TYPES` get no rabble; the boss room gets a single boss; the start room never gets enemies (except a degenerate single-room floor). **Every non-reward room drops a single reward pedestal on clear** (`LootDirector.dropRoomReward`); maze rooms also hold a chest at their deepest tile, placed at generation. Floor loot placement is deferred to `startRun`/`advanceFloor` so the party filter sees the settled party. See [docs/upgrades.md](docs/upgrades.md).

**Debug "showcase" floors**: a 1×1 grid with a chosen room type maps to `DungeonOptions.showcaseRoomType`, building a fixed 3-room line (combat start → chosen room → combat exit) so shop/shrine/boss rooms get a real spawn + exit. A bigger grid forces every room to the type (`forceRoomType`).

**Barriers are one-way, via a collision-filter trick.** A room's `barrierParent` (blocks advance until cleared) is a plain wall. Its `barrierChild` (blocks retreat once you're in) is one-way: latecomers walk in, nobody walks out. Matter collision is symmetric, so the barrier sits on `Layer.BARRIER_EXIT` and only a COMMITTED player's mask includes that bit (`PhysicsWorld.setPlayerCommitted`, re-evaluated each tick from `FloorManager.isCommittedAt`). Commitment is tested on the room **interior** (inset a tile past the doorway) — that inset is load-bearing. Projectiles aren't matter bodies and consult `physics.barrierAt()`, where both sides block.

**Enemies don't exist until you walk in (deferred spawning).** `SpawnDirector.spawnFloorEnemies` constructs every enemy up front (confined, party-scaled, registered with FloorManager so its room locks) but holds each **unspawned**: out of `state.enemies`, skipped by AI/contact, not a combat target. `GameRoom.tick` reveals a room's whole batch at once the first time a player is inside it or in a touching passageway (`FloorManager.occupiedRoomIds`). Adding to `state.enemies` is what makes the client draw it, so the client plays a dust puff on every `enemies.onAdd` (`SpawnFX`) — no extra broadcast. `Enemy._spawned` defaults to **true**, so a summon or a test enemy against a bare `PhysicsWorld` is active immediately. Every enemy is **confined to its home room** (`Enemy.confineTo`, set at the one `addEnemy` choke point) — movement intent clipped per-axis at the interior bounds, knockback deliberately NOT clipped.

**Empty room finalization**: after `spawnFloorEnemies()`, `finalizeEmptyRooms()` marks zero-enemy rooms pre-cleared and removes their `barrierParent` (no enemies = clear condition never fires, so reward rooms would lock forever). **`spawnBoss()` must run before `finalizeEmptyRooms()`** (it's called at the end of `spawnFloorEnemies()`) or the boss room is pre-cleared and never locks. `checkPlayerEnteredRoom()` also skips `barrierChild` for empty rooms so players can retreat.

**Room challenges**: a `RoomChallenge` (`server/src/rooms/challenges/`) is OO like `Enemy` — one subclass per objective, picked by an exhaustive `switch` on `RoomType` in `GameRoom.challengeFor`. `GameRoom` holds `Map<roomId, RoomChallenge>` mirrored to `state.challenges` (generic label + progress/goal, so new challenges need no schema change). Two exist: `WaveChallenge` (continuous attrition — a fixed total fed in, each kill spawns a replacement up to a cap) and `TimedClearChallenge` (clear in 45s → bonus pedestal; running the clock out is deliberately NOT a failure — the game has no failure state; the clock starts only when a player is in the room). **FloorManager needs no special case because of tick ordering**: `challenge.onEnemyDown()` runs *before* `floorManager.onEnemyMaybeCleared()` in tick step 4, so a fresh wave is already in the room's set when the clear test evaluates. Step 4 collects dying ids before iterating so a challenge spawning enemies doesn't mutate `this.enemies` mid-`forEach`.

**Dark rooms are client-only.** `type: "dark"` is an ordinary combat room server-side. The whole variant is `client/src/map/DarknessOverlay.ts` (the client regenerates the same dungeon from the same seed). The generator gives dark rooms no cover blocks (invisible cover only snags). Gotcha the overlay documents: **`setScrollFactor(0)` does not exempt an object from camera zoom** — at 2× a screen-space overlay renders double-size and displaced, so the darkness is anchored in world space.

**Trap tiles**: `TILE.TRAP` warps the party `TRAP_MIN_FLOORS`–`TRAP_MAX_FLOORS` floors forward (skipping their loot/shops while difficulty climbs). Rendered in plain sight. Placement is **last** in `generateDungeon` (only tiles still plain `TILE.FLOOR` are eligible, so it can't eat stairs/boss passageways) and uses the **seeded rng** (client generates its own map — a server-only roll would desync). Because it's last, adding it changed no existing seed's layout.

**Stairs are never covered**: they go at the exit room's center tile, also where a shop lays its middle pedestal. Two rules: `dungeonGenerator.ts` picks the exit as the farthest room from start whose type isn't in `STAIRS_AVOID_TYPES` (shop, shrine — add any future prop-placing type), and `spawnShops()` nudges each pedestal to the nearest plain-`FLOOR` column. When start === exit, the spawn steps to the nearest open tile so the player doesn't descend instantly.

## Colyseus state sync pattern

```ts
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

`onAdd` fires for items already in the map when the callback registers, so this handles initial state too.

## How to change things

- **Tile type**: add ID to `TILE` + `TileProps` to `TILE_PROPS` (`shared/src/types.ts`); add a frame in `assets/generate-dungeon-tiles.js` + an entry in `special`, run `npm run assets:tiles`, add a `case` in `TileRenderer.buildMap`; emit the ID from the carve logic in `dungeonGenerator.ts`.
- **Change the map**: it's generated. Change `MAP_SEED` (`shared/src/tileData.ts`) for a different floor-1 layout (each descent = `seed+1`). For structure, edit the phase in `generateDungeon` (buildRoomGraph → growToMinRooms → assignRoomTypes → carveRooms → carveDoorways → carveEntryCorridors → buildConnections → pickExitAndSpawn → stampBossPassage → placeTraps). **Determinism is the contract** — any change to rng draw ORDER changes every seed's map and can desync a live game; verify by diffing `generateDungeon` output over a few hundred seeds + the option variants before/after. `roomCellAt` (which cell a point is in) and `roomInteriorContains` (inside, excluding the 1-tile border) are deliberately separate; the border inset is load-bearing (doorways punch through it).
- **Character class / skin**: new class = a `Character` subclass (`shared/src/characters/<Class>.ts`) + the `CharacterClass` union + an instance in `CHARACTERS`. New skin = a PNG in the 15×4 humanoid layout, `npm run assets:build`, add to `CHARACTER_TYPES` + `CLIENT_CHARACTER_VISUAL_REGISTRY`.
- **Enemy / boss / weapon / ammo / upgrade / weapon-mod / attack / room type**: all OO — see the matching doc and "Add …" recipes. In short: subclass the base, override the getters, add to the array/union; no schema or registry table. An attack is a `Spell`; only add an `InputMessage` field for a genuinely new *control*.
- **Genuinely new entity type (NPC, not enemy/boss)**: new schema extending `EntityState` → new class extending `Entity` (override `tick()`) → field on `GameState` → spawn+tick in `GameRoom` → client class extending client `Entity` → wire `onAdd`/`onRemove`/`onChange` in `GameScene.setupWorldSync()`.
- **New Colyseus room type**: a `Room` subclass in `server/src/rooms/`, registered in `server/src/index.ts` with `gameServer.define()`, joined by name from the client.

## Where balance lives

| Knob | File |
|---|---|
| Player/class (maxHp, speed, usable categories) | `shared/src/characters/<Class>.ts` (getters) |
| Weapon (damage, cooldown, force, fxType) | `shared/src/weapons/<category>/<id>/index.ts` (or category `base.ts`) |
| Melee swing geometry (reach, arc, wind-up) | **the FX art** — edit the strip, re-run `node assets/generate-fx-hurtboxes.js`. Never hand-tuned |
| Melee combo / hard swing multipliers | `comboNDamage/KnockbackMult`, `hardDamage/KnockbackMult` getters on the `Weapon`/category base. Grace window + charge threshold are client Options (`comboWindowMs`/`chargeHoldMs`, defaults in `shared/src/types.ts`) |
| Staff feel | staff `ammoId` + `attackCooldownMs`; bolt damage/speed/pierce in `shared/src/ammo/bolts/<id>/index.ts` |
| Ammo/projectile | `shared/src/ammo/<id>/index.ts` (ranged weapon `damage` is a flat bonus on top of ammo base; speed/pierce live on ammo) |
| Enemy hurt size | **the sprite art** — replace the PNG, `npm run assets:hurtboxes` |
| Enemy (hp, speed, aggro, attack, kb resist, flying height) | getters on the `Enemy` subclass — `server/src/entities/enemies/<Name>.ts` |
| Boss (moveset, movement, phases, stats) | the `Boss` subclass — `server/src/entities/bosses/<Name>.ts` |
| Upgrade effects | the `Upgrade` subclass — `server/src/upgrades/stats.ts` |
| Weapon-modifier rolls | `rollWeaponMod` in `server/src/upgrades/weaponMods.ts` |
| Reward pedestals (mix, choice count) | `rollOffer` / `OFFER_CHOICES` in `LootDirector.ts` |
| Room-clear rewards, maze chests | `ROOM_REWARD_*`, `*_CHEST_*` in `LootDirector.ts` |
| Traps (rate, rooms, margins) | `TRAP_*` in `dungeonGenerator.ts`; warp depth `TRAP_MIN/MAX_FLOORS` in `types.ts` |
| Store (count, price tiers, buy radius) | `SHOP_ITEM_COUNT` / `SHOP_TIERS` / `BUY_RADIUS` in `LootDirector.ts` |
| Enemy spawn counts / pools / boss placement | `SpawnDirector.ts` |
| Loadout keybinds / acquire freeze | `client/src/input/InputSource.ts`, `ACQUIRE_MS` in `AcquireFX.ts` |
| Knockback/hitstun, tick rate, enemy count, body geometry | `shared/src/types.ts` |
| Debug-menu knobs | `client/src/debug/debugFields.ts` (+ `shared/src/debug.ts`) |
| Client options (zoom, overlays) | `client/src/options/gameOptions.ts` |

## Gotchas

- **Tile vs pixel coords**: tiles are 32×32 px. `entity.state.x/y` are pixel coords (sprite center). Tile = `Math.floor(x / TILE_SIZE)`; spawn points are `col * TILE_SIZE + 16`.
- **Server physics is matter-js** (`PhysicsWorld.ts` only). Each entity is a radius-5 circle at the sprite's *feet* (`body.y = state.y + FOOT_OFFSET(8)`); `state.x/y` stays the sprite center. Movement: `Entity.move()` records px/sec → `commitVelocity()` (px/sec ÷ 60 to Matter units — get this wrong and everything moves ~3× off) → `Engine.update(50)` → `syncFromBody()`. `ENTITY_RADIUS` must stay ≤ ~14 or 32px gaps close. Enemy melee `attackRadius` is center-to-center and must exceed `2 × ENTITY_RADIUS` or attacks never land against rigid separation (goos use 14). Dying enemies get a WALL-only mask (`setEntityDead()`). **All teleports go through `Entity.teleport()`** — never assign `state.x/y` for position (the body won't follow).
- **Walking bounds and hurt bounds are separate, both MEASURED FROM ART.** `ENTITY_RADIUS` (5px, feet) is collision. Damageable area is a per-creature box (`halfW`/`halfH` + offset) in `shared/src/enemies/hurtBounds.generated.ts` from `assets/generate-enemy-hurtboxes.ts`. No hand-tuned hurt size anywhere — `Enemy.hurtBounds` reads `ENEMY_HURT_BOUNDS[typeId]`, `Player` reads `PLAYER_HURT_BOUNDS` (union across all 12 skins). Bounds are the union of each enemy's frames (can't dodge by animating). The resolver's `shapeHitsBox` is exact for rect/circle, falls back to circumradius for segment/sweptEllipse (errs inclusive). An enemy's `attackRadius` subtracts `PLAYER_HURT_BOUNDS.halfW` in `contactHitSource`.
- **`spriteGeometry.ts` is Phaser-free on purpose** — the hurtbox generator imports it (requiring the visual defs in Node throws `window is not defined`), so client render and server hit-test can't diverge. `Record<EnemyType, …>` makes a missing entry a compile error.
- **Enemies stay dead — no respawn.** Cleared rooms stay cleared; everything is wiped and respawned only when `advanceFloor()` regenerates the floor.
- **Camera is room-locked (Zelda-style)**: each frame `GameScene.update()` snaps `camera.setBounds()` to the 21×16-tile room containing the local centroid at 2× zoom, then `centerOn`. Crossing a doorway hard-cuts to the next room.
- **Colyseus schema fields hold data, not behaviour — and an UNDECORATED property on a `Schema` is a legit place for server-only state.** `OfferChoiceState.mods` / `RewardState.mods` / `ChestState.weaponId`+`mods` hold rolled `WeaponMod`s with no `@type`, so they never serialize (mod values are getters; rebuilding client-side would need the forbidden id→class map). Colyseus preserves the property through `ArraySchema.push`. Comment it — a mixed synced/unsynced object misleads readers. These must NEVER appear in `stateViews.ts` (the client would be typed to read `undefined`).
- **The client reads state through typed VIEWS (`stateViews.ts`), so renaming a synced field is a server-side compile error (`TS2420`), not a silent runtime `undefined`.** Views carry synced fields ONLY. `room.state` still needs its one documented cast per boundary (colyseus.js hands over untyped decoded state).
- **Anything diffing a player's weapons must key on the instance `uid`, not the weapon id** — duplicates of the same weapon are legal, so an id-based `includes()` swallows the second pickup. Same trap in `InventoryHud`'s change signature (built from uids because `join(",")` over objects yields `[object Object]`).
- **No persistence**: all state is in-memory. Server restart = everyone rejoins fresh.
