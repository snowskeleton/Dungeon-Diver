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
| [docs/lobby.md](docs/lobby.md) | Touching menus, the room browser, the lobby, matchmaking, or the pause menu |
| [docs/upgrades.md](docs/upgrades.md) | Touching player stats, weapon modifiers, damage numbers, or reward pedestals |
| [docs/enemies.md](docs/enemies.md) | Adding or balancing an enemy |
| [docs/bosses.md](docs/bosses.md) | Designing or building a boss moveset (per-boss abilities spec + bestiary text) |
| [docs/boss-implementation-plan.md](docs/boss-implementation-plan.md) | Sequencing the boss/layers build — what to implement in what order |
| [docs/layers.md](docs/layers.md) | Touching collision, projectile targeting, friendly fire, or hit resolution |
| [docs/assets.md](docs/assets.md) | Adding or replacing art |
| [docs/retrodiffusion.md](docs/retrodiffusion.md) | Generating new art with the RetroDiffusion AI (icons, ammo, props, tiles) |
| [docs/playtest-2026-07-20.md](docs/playtest-2026-07-20.md) | Picking up bug/feel work — the first external playtest's notes, sorted into bugs / quick wins / direction |
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

## Tests

**Vitest, at the repo root.** One suite covers `shared/` and `server/`; it boots the
real physics, entities, combat, directors, and GameRoom itself with no server and no
browser.

```bash
npm test                 # the whole suite
npm run test:watch       # watch mode
npm run test:coverage    # + a v8 coverage report in coverage/
npx vitest run tests/server/combat-resolver.test.ts   # one file
```

Tests live in `tests/`, mirroring the source: `tests/shared/` (geometry, weapons/ammo
registries, the dungeon generator, config), `tests/server/` (the combat resolver,
entities, spells, projectiles, upgrades, loot, floor/barriers, challenges, spawning,
bosses, and GameRoom end-to-end). Shared scaffolding is in `tests/helpers/`:

- `helpers/world.ts` — a flat map, a real `PhysicsWorld`, and `arena()`, which runs the
  **exact** gather-and-resolve step `GameRoom.tick` runs. Use it for anything about
  damage; a test that resolves combat differently from the game proves nothing.
- `helpers/gameRoom.ts` — `createRoom()` / `startedRoom()` drive a REAL `GameRoom` with
  only Colyseus's transport stubbed (setState/lock/metadata/broadcast/onMessage), so
  tick ordering, the lobby phase, floor advancement, and the message handlers are all
  the shipping code.

### How to write one here

**Assert behaviour and relationships, never balance numbers.** `10 damage removes 10 HP`
and `15 damage through 7 armor lands as 8` survive a retune; `a broadsword deals 20`
does not. Where a shipping value is unavoidable, derive it (`WEAPON_REGISTRY[...].damage`)
rather than typing it. This replaced the old `verify-*.ts` scripts and their
golden-output baseline, which pinned HP and damage totals and so failed on every
balance pass without ever catching a real defect.

Two deliberate exceptions, both contracts rather than tuning:

- **The dungeon map checksum** (`tests/shared/dungeon.test.ts`). Client and server each
  generate the floor from the same seed, so any change that consumes rng draws in a
  different ORDER silently changes every seed's map and can desync a live game. A
  deliberate generation change means re-running and pasting in the new value — and
  knowing you changed every existing seed's layout.
- **Tests named `BUG:`** pin known-broken behaviour as it actually is, with the cause in
  a comment, so the gap is visible instead of quietly asserted away. Fixing one means
  rewriting its test to assert the correct behaviour.

Melee swings genuinely wind up (the FX strips' leading frames are empty), so
"attack once and assert" never works — hold the attack across ticks, or use
`swingUntilHit()` from `helpers/world.ts`.

**After replacing any PNG in `assets/`, run `npm run assets:build`** or the client keeps loading the old copy. See [docs/assets.md](docs/assets.md).

## Project structure

```
shared/src/
  types.ts             ← tile IDs + TILE_PROPS, InputMessage, RoomType, and the few cross-cutting constants (SERVER_TICK_MS, KNOCKBACK_* scale/stun knobs, enemy-count formula, ENTITY_RADIUS/FOOT_OFFSET, FLYING_CRUISE_HEIGHT). Balance does NOT live here — see characters/, enemies/, weapons/, ammo/
  characters/          ← one CharacterConfig per class (Knight/Rogue/Ranger/Mage): id, name, maxHp, speed, defaultWeaponId; index.ts exports CHARACTER_REGISTRY. Weapon stats live in weapons/, not here. base.ts also holds `CHARACTER_TYPES` (12 humanoid skins) with the CharacterType union DERIVED from it, so the runtime list and the union can't drift; index.ts also exports `resolveCharacterClass`/`resolveCharacterType`, the validators every client-supplied id must pass through
  enemies/             ← just the EnemyType id union + EnemyFacingMode (base.ts). Enemies are OO classes on the SERVER (server/src/entities/enemies + /bosses) — there is NO EnemyConfig and NO ENEMY_REGISTRY (that data-driven design was abandoned; see the engineering note)
  combat/              ← Attack (damage/knockback/source payload) + HitShape geometry (rect/circle/segment/sweptEllipse + shapeHitsPoint / shapeHitsBox). Shared so the client H-overlay can reuse shapes; the resolver itself is server-side
  upgrades.ts          ← the UpgradeId union + UPGRADE_IDS + UpgradeSlotView (the descriptive wire shape). The Upgrade CLASSES are server-side — this mirrors how EnemyType is a shared union with server-side classes
  weapons/             ← weapons are OO like enemies: `Weapon` base (abstract, stats as getters) → a category base (`Sword`/`Bow`/`Staff`/… in <category>/base.ts, the category's defaults) → one concrete class per weapon in <category>/<id>/index.ts (+ <id>.png icon), overriding only what differs. index.ts exports `WEAPONS: WeaponClass[]` (the array of classes, mirroring REGULAR_ENEMIES) and derives `WEAPON_REGISTRY` (id→template) from it, plus the WeaponId union. instance.ts = WeaponInstance/WeaponMod (a WIELDED weapon: template + uid + modifiers) + WeaponSlotView (the wire shape); views.ts = viewFromSlot/viewFromTemplate adapters. A weapon's `id` getter is typed `WeaponId` so a typo is a compile error. Each weapon carries its own fxType; ranged ones override ammoId + rangedStyle (staves are ranged: `rangedStyle: "cast"` + a per-staff elemental bolt). An `aoe` getter is still supported by `weaponSpell` (wind-up + nova) but no shipping weapon overrides it today — it's reserved for the Mage's nova ability
  ammo/                ← projectiles ranged weapons spawn; OO like weapons (abstract Ammo base → category base Arrow/Bolt/Boomerang → concrete ammo class, stats as compiler-checked getters). Behaviour-sharing groups nest under a category base (arrows/, bolts/, boomerangs/); one-offs (throwing-knife, throwing-star) sit flat. index.ts exports AMMO_CLASSES + the derived AMMO_REGISTRY + AmmoId union
  debug.ts             ← DebugConfig (the Debug menu's flat settings object) + DEFAULT_DEBUG_CONFIG + toDungeonOptions()
  lobby.ts             ← the lobby/matchmaking layer: RunPhase, create/join options, RoomMetadata (what a room browser reads WITHOUT joining), the lobby message payloads, and the room-code alphabet. See docs/lobby.md
  stateViews.ts        ← the synced shape of every schema, as read-only interfaces. Server schemas `implements` these, so a renamed @type field is a server-side compile error instead of a silent `undefined` on the client. SYNCED FIELDS ONLY — see the gotcha below
  dungeonGenerator.ts  ← seeded dungeon generation: generateDungeon(seed, opts?) builds a 5×4 grid of 21×16-tile rooms (105×64 tiles total), room graph, type assignment, tile carving, connections/barriers. `opts: DungeonOptions` overrides grid size, forced room type, boss, stairs
  tileData.ts          ← exports MAP_SEED + MAP_DATA = generateDungeon(MAP_SEED), plus spawn/room-center helpers
  index.ts             ← the "shared" package surface (client's Vite aliases `shared` → this file)

server/src/
  index.ts                  ← Colyseus Server setup (http + ws on port 2567) + GET /api/rooms/by-code/:code (the only way to reach a PRIVATE room — Colyseus's own listing deliberately omits them)
  rooms/roomCodes.ts        ← allocating a collision-free 4-char join code, and resolving one back to a room id via matchMaker.query
  rooms/GameRoom.ts         ← main 20 Hz game loop; owns the PhysicsWorld + CombatSystem + the two directors below; join/leave/input/AI tick, then drains every entity's queued effects into the one combat resolve, challenge plumbing, floor advancement (stairs → seed+1). Loot and spawning were split out — resist growing them back in here
  rooms/LootDirector.ts     ← everything reward-shaped: shops, shrine/boss/challenge offers, chests, the rolls behind them, and the validate-then-grant half of the buy/offerPick/chestOpen messages (GameRoom's handlers are one line each)
  rooms/SpawnDirector.ts    ← everything that puts a creature on the floor: the per-room rabble pass, the floor's boss, boss summons, the enemy pool + count. One private addEnemy() is the only place an enemy comes into existence
  floor/FloorManager.ts     ← barrier/door system: locks rooms on entry, unlocks on clear, pre-clears empty rooms
  physics/PhysicsWorld.ts   ← the ONLY file that touches matter-js: engine, wall bodies, per-body layer/solidMask collision filters (from each entity's InteractionProfile — see shared/src/layers.ts), px/sec↔matter velocity conversion, sprite-center↔foot-body coordinate mapping
  combat/                   ← the ONE combat resolver. CombatSystem.resolve() applies every HitSource ({shape, affects, attack, claim}) to every CombatTarget when affects&layer + shape overlaps target.hurtBounds (shapeHitsBox) + not-owner + claim passes → target.takeHit(Attack). Returns the HitEvent[] it landed (target pos + damage), which GameRoom broadcasts as `hits` for the client impact spark. RehitGate = per-target re-hit dedupe for lingering hitboxes. HitShape geometry + the Attack payload live in shared/src/combat
  spells/                   ← the unified ability system. Spell (windUp→strike→active→recover + cooldown it OWNS via isReady/markCast; activeMs/cooldownMs are GETTERS so a WeaponSpell can read its instance live); SpellCaster runs the lifecycle (shared by bosses, enemies, players); Caster = the tiny interface a spell needs ({x,y,facing,attackAffects,emitHitSource,spawnProjectile,scaleAttack,buildAttack}); builders.ts = volley/radial/tremorLine/dashAttack/whirl; weaponSpell.ts turns a WeaponInstance into a swing / shot / AOE spell
  entities/Entity.ts        ← base class: move()/knockback/hitstun (overage threshold), takeHit(Attack), applyTileEffects(), teleport(), and the emitHitSource/spawnProjectile effect buffer GameRoom drains — shared by Player + Enemy
  entities/Player.ts        ← extends Entity, is a Caster; looks up its CharacterConfig; applyInput() drives a SpellCaster running the active weapon's Spell (swing/shot/AOE). Owns `weapons: WeaponInstance[]` + `upgrades: Upgrade[]`, folds them into its own stats (maxHp/speed/damage/armor/lifesteal), and is the ONLY scaleAttack override in the game. See docs/upgrades.md
  entities/Enemy.ts         ← abstract base; default tick() = patrol/chase AI + contactHitSource() (touch damage as a hitbox); death. Stats are per-class getters, no config. Flying is one such getter: `cruiseHeight` (0 = grounded) — a flyer (bat, floater, wyvern) overrides it and the base tick keeps `state.airHeight` there each tick (a dive spell overrides it mid-cast); `setAirHeight()` lets a spell drive it. Collision stays at the ground point — height is purely visual
  entities/enemies/         ← the OO enemy classes (goos/bats/floaters/critters/directional), one Enemy subclass each; REGULAR_ENEMIES = the spawn-pool array (index.ts). No config, no ENEMY_REGISTRY
  upgrades/                 ← the OO upgrade system: Upgrade base (zero-returning stat getters + a deferred spell() hook) + one class per upgrade in stats.ts + UPGRADES array; weaponMods.ts = concrete WeaponMods a reward pedestal rolls. No UPGRADE_REGISTRY, no id→effect table
  entities/Boss.ts          ← abstract Boss (extends Enemy, is a DashCaster); picks the next Spell and delegates to a SpellCaster; deals no passive contact damage. entities/bosses/ = one Boss subclass each + movement.ts + BOSSES array
  entities/Projectile.ts    ← kinematic arrow/thrown-weapon (no matter-js body); integrates position, swept-ellipse hitSource(), pierce, boomerang return, wall/lifetime despawn. Pulls its AmmoConfig from AMMO_REGISTRY
  schema/EntityState.ts     ← Colyseus schema base (x, y, health, speedMultiplier)
  schema/PlayerState.ts     ← extends EntityState (facing, isAttacking, attackSeq, characterClass, characterType, weaponId=active, weapons[]=WeaponSlotState, activeWeaponIndex, maxHp, upgrades[])
  schema/WeaponSlotState.ts ← one wielded weapon on the wire: RESOLVED stats + modLabels, never the modifier objects (see docs/upgrades.md for why)
  schema/OfferState.ts      ← a reward pedestal's SHARED 1-of-3 (shrine boon / boss drop): the whole party sees the same `choices`, and picks are mutually exclusive — `consumed` holds the indices already taken (greyed for everyone) and `claimedBy` the session ids that have spent their one pick, so at most 3 items leave (one per player until the set empties). OfferChoiceState.mods is an UNDECORATED field — server-only, never synced
  schema/ChestState.ts      ← a chest room's chest. No choice and no cost: interact and the weapon is yours. weaponId/mods are UNDECORATED (server-only) both because mods are behaviour AND because syncing them would spoil the surprise
  schema/EnemyState.ts      ← extends EntityState (aiState, targetId, facing, isDying, stunned, enemyType, telegraph/channeling/abilityId for bosses, airHeight for flyers)
  schema/ProjectileState.ts ← extends EntityState (angle, ammoId, ownerSessionId)
  schema/ShopState.ts       ← ShopItemState (weaponId, cost, purchased, x/y pedestal pos) + ShopState (roomId, items[])
  schema/GameState.ts       ← root schema: MapSchema of players + enemies + projectiles + shops (keyed by room id), floor number, `paused` flag

client/src/
  main.ts                   ← Phaser.Game config (800×576, pixelArt, WebGL); scene list [MenuScene, BrowseScene, LobbyScene, GameScene] — MenuScene auto-starts. Dev-only placeholder-asset report + `window.__game`
  launch.ts                 ← Loadout + pickLoadout() = character picker → weapon picker. Run from the LOBBY on a player who already exists, so it pre-selects the current pick (a class change falls back to that class's starting weapon)
  net/serverUrl.ts          ← the ws endpoint AND its matching http origin, resolved together so the socket and the REST calls can't disagree about where the server is
  net/Party.ts              ← the 1–4 connections this machine holds to one room. Built in the LOBBY and handed to GameScene, which joins nothing. Also listRooms() for the browser. See docs/lobby.md
  options/profile.ts        ← name + last-used loadout, persisted. What removed the two mandatory picker modals in front of the game
  scenes/MenuScene.ts       ← title screen: Play Solo / Play Online / Options / Debug. Solo and Debug host a PRIVATE room; all four paths end in a lobby
  scenes/BrowseScene.ts     ← the room browser: public list (polled), join-by-code, host-a-room
  scenes/LobbyScene.ts      ← party staging in the room you'll play in; watches state.phase and starts GameScene when it flips to "run"
  scenes/GameScene.ts       ← main scene; init({party, debug}) resets per-run state, create() builds views for the party's existing connections, wires state sync (players/enemies/projectiles/shops) + floor-change/barrier messages, room-locked camera. Owns the inventory HUD, PAUSED overlay, P1 store card, and the pause menu. Esc → pause menu
  characters/index.ts       ← CLIENT_CHARACTER_VISUAL_REGISTRY (CharacterType → preload/defineAnimations/spriteConfig)
  enemies/index.ts          ← CLIENT_ENEMY_REGISTRY: a thin `Record<EnemyType, ClientEnemyDef>` wiring table — each id maps to a named def imported from a group module. No definitions here; the annotation makes the compiler flag any id missing a def
  enemies/{goos,bats,floaters,critters,directional}.ts ← per-group visual defs (name + textureKey + displayW/H + `airborne?` + preload/defineAnimations/resolve()), mirroring the server's entities/enemies/*.ts grouping. Add an enemy by exporting its def here + one line in index.ts
  enemies/bosses/           ← one visual-def module per boss (TurtleDragon/Wyvern/TenguMask + simple.ts) — where the ability-driven row-swap closures live — plus factory.ts (the boss() 2×-size helper). Mirrors server entities/bosses/
  enemies/sheetEnemy.ts     ← makeSheetEnemyDef(): horizontal art (one side view, flipX for left). Handles multi-row sheets + non-square cells via explicit moveFrames
  enemies/directionalEnemy.ts ← makeDirectionalEnemyDef(): 4-row sheets, one row per facing (up/right/down/left), never mirrored
  enemies/spriteGeometry.ts ← Phaser-FREE table of each enemy's cell size / frames / display size, keyed by EnemyType. The factories above read it AND the enemy-hurtbox generator imports it (importing the visual defs in Node throws `window is not defined`), so render layout and hit-test geometry can't diverge
  weapons/index.ts          ← CLIENT_WEAPON_REGISTRY (name + placeholder-art flag; feeds PlaceholderReport)
  entities/Entity.ts        ← base Phaser class: rectangle anchor + HP bar; setupCharacter()/playAnim() for registry-driven characters, useRawSprite() for self-animating sprites (enemies), attack FX with per-frame weapon icon tracking
  entities/SpriteClips.ts   ← shared clip-definition helpers used by HumanoidSprites and the enemy sprite factories (client/src/enemies)
  entities/HumanoidSprites.ts ← shared 15-col × 4-row humanoid sheet layout, clip definitions, makeHumanoidSpriteConfig()
  entities/WeaponVisuals.ts ← the WeaponVisual interface + one class per style (HeldWeaponVisual / HeldBowVisual / HeldStaffVisual / NovaVisual / NoVisual) and the factory that picks one. Entity holds ONE of these and calls sync/playAttack unconditionally — add a weapon style as a class here, never as another nullable field on Entity. Every hand weapon is HELD IN HAND at rest (its icon in the right hand at the weapon's `iconAngle`, like the staff), not just shown during the swing — HeldWeaponVisual does this (icon + slash strip on attack); the `holdWeaponIconAtRest` pose lives in AttackFXSprites. Thrown weapons are the exception — nothing in hand (the projectile is the whole visual)
  entities/AttackFXSprites.ts ← one-shot slash/stab FX strips, rotated per facing
  entities/HitFX.ts         ← the impact spark: a pooled one-shot sprite played wherever a hit LANDS. GameScene plays one per point in the server's `hits` broadcast (see the combat resolver). Fire-and-forget world confetti, no owner — pooled here, not on the enemy that may die mid-animation
  entities/SpawnFX.ts       ← the dust puff played wherever an enemy SPAWNS. Pooled like HitFX; GameScene plays one per `enemies.onAdd`, which (with deferred spawning) only fires when the server reveals an enemy — a room being entered, or a boss summon
  entities/RangedWeaponFX.ts ← "held" ranged draw: 2-frame bow/crossbow sheet played 0→1→0→0 beside the player, rotated to fire direction
  entities/ProjectileEntity.ts ← lightweight (no HP bar) projectile view; lerps to server pos, points along angle or spins per AmmoConfig
  entities/LocalPlayer.ts   ← extends Entity; reads InputSource, sends to server, hp field for HUD. Weapon-swap on active change, cycle/menu/buy actions, shop proximity, acquire-diff → AcquireFX + input freeze
  entities/RemotePlayer.ts  ← extends Entity; lerps toward server position, drives anim from server's facing/isAttacking/attackSeq + inferred movement; swaps weapon visuals on weaponId change
  entities/EnemyEntity.ts   ← extends Entity; lerps toward server position; asks CLIENT_ENEMY_REGISTRY[enemyType].resolve(state) for the clip/static frame + whether to mirror. For `airborne` defs it lifts the sprite by the synced airHeight and scales a ground shadow beneath it
  entities/ShopItemEntity.ts ← in-world shop pedestal view (icon + HP-cost label); ghosts out when purchased. Not an Entity (no HP bar)
  entities/AcquireFX.ts     ← one-shot "item get!" flourish: weapon icon pops above the head + centered stats panel. Takes the synced SLOT so it shows the ROLLED stats; fires on a new weapon uid appearing
  entities/OfferPedestalEntity.ts ← in-world reward pedestal (pulsing "?"); ghosts out once claimed. Not an Entity (no HP bar)
  input/InputSource.ts      ← interface + KeyboardInputSource (wasd/arrows) + GamepadInputSource. read()=movement/attack; readActions()=discrete intents (prev/next slot, toggle menu, interact/buy) edge-detected by LocalPlayer
  input/LocalPlayerManager.ts ← builds one LocalPlayer VIEW per party member and assigns its input device by seat; getCentroid() for camera. It no longer dials the server — see net/Party.ts
  ui/FieldPanel.ts          ← generic DOM settings panel rendered from a FieldSpec list (toggle/number/select/multiselect) + optional preset chips; backs both Options and Debug
  ui/CharacterPicker.ts     ← join-time class + skin chooser (DOM overlay), shown before the weapon picker
  ui/WeaponPicker.ts        ← join-time weapon chooser (DOM overlay)
  debug/debugFields.ts      ← DEBUG_FIELDS + DEBUG_PRESETS: the Debug menu as data. Add a knob here (and to shared DebugConfig); the panel renders itself
  options/gameOptions.ts    ← OPTION_FIELDS + localStorage-backed GameOptions (camera zoom, hitbox overlay, controls hint)
  ui/menuDom.ts             ← the ONE stylesheet + builders (`el`/`button`/`menuPanel`/`selectOne`/`addStyle`) behind every full-screen DOM overlay — browser, lobby, pause, both pickers, inventory, offer, confirm, FieldPanel. A panel's own file adds ONLY what makes it different (portrait cropping, weapon tabs, the confirm dialog's red frame), via `addStyle`
  ui/LobbyPanel.ts          ← the lobby's DOM view: roster, ready badges, host's Start button
  ui/RoomBrowserPanel.ts    ← the browser's DOM view: room list, code box, host form
  ui/PauseMenu.ts           ← D7's resumable pause menu (Resume / Inventory / Options / Abandon run)
  ui/sceneBackdrop.ts       ← the canvas drawn behind a DOM menu scene
  ui/GameHud.ts             ← the always-on screen furniture: party HP, floor line, PAUSED overlay, P1 store card, controls hint. Lives on the UiLayer (zoom-1 UI camera)
  ui/InventoryHud.ts        ← fixed HUD row of owned weapons, active slot highlighted (rebuilds only on change)
  ui/InventoryMenu.ts       ← pause menu (DOM overlay): owned weapons + expanded stats + rolled mod labels + held upgrades; opening it pauses the room
  ui/weaponStats.ts         ← weaponStatLines(WeaponView) → stat rows; re-exports the shared viewFromSlot/viewFromTemplate adapters. Shared by store card, acquire panel, inventory menu, offer picker
  ui/OfferPicker.ts         ← the 1-of-3 reward picker (DOM overlay, modelled on InventoryMenu); pauses the room while open
  debug/HitboxDebug.ts      ← press H in-game: draws ALL hit/hurtboxes live. Each entity implements collectDebugShapes() from debug/DebugDraw.ts, so the overlay is generic
  debug/hurtboxShapes.ts    ← melee-swing hurtbox shapes, shared by LocalPlayer and RemotePlayer
  dev/PlaceholderReport.ts  ← dev-only: lists placeholder art in the console AND the npm-run-dev terminal (via terminalLogPlugin)
  map/BarrierOverlays.ts    ← the tiled images over locked doorways, keyed by connection id (showParent/showChild/hideParent/hideChild/clear)
  map/TileRenderer.ts       ← buildMap() renders MAP_DATA from the dungeon-tiles.png tileset (TILE_TO_FRAME map); tweens fire/stairs/boss tiles; still generates the barrier texture programmatically
  public/sprites/           ← PNGs Phaser loads at runtime (copied by `npm run assets:build`)
```

## Key architectural decisions

**Authoritative server**: clients send `{ dx, dy, attack }` inputs; server computes all movement, collision, combat, and AI. Client only renders interpolated positions.

**A room's lobby and its run are the same Colyseus room, in two phases.** `GameState.phase` is `"lobby"` until the host starts it, then `"run"` forever. Nothing simulates in the lobby and no enemy exists yet — `spawnFloorEnemies()` runs from `startRun()`, not from the first join — so the party is settled before the floor is populated. "No dropping into a run in progress" (playtest D12) is then just `room.lock()`: a locked room is both unlisted and unjoinable, so there is no second door. Solo is not a separate path — it is a private room nobody can find. See [docs/lobby.md](docs/lobby.md).

**One Colyseus connection per player** — even for same-screen co-op. P1 uses WASD+Space, P2 uses arrows+Enter, P3/P4 use gamepads. Press **P** in the **lobby** to add a couch player — mid-run it only prints a hint, because the room is locked once the run starts. All connect to the same room, so couch co-op and online co-op are the same thing from the server's side.

**First player's room is the world observer**: `GameScene` uses `localPlayers[0].room.state` to watch all players + enemies and render remote entities. Enemies are never locally controlled.

**Async `create()` guard**: Phaser doesn't await async `create()`, so `update()` can run before setup is done. Guard: `private ready = false` set at end of `create()`; `update()` returns early if `!this.ready`.

**Tile system**: `shared/src/types.ts` defines `TILE_PROPS` keyed by tile ID. Server's `Entity.ts` reads these for walkability checks and tile effects. Client's `TileRenderer.ts` renders the same generated `MAP_DATA` using frames from the `dungeon-tiles.png` tileset — same data, no sync needed.

**Content styles.** **Enemies, bosses, weapons, and ammo are object-oriented**: one subclass each, stats as compiler-checked getters resolved up an `extends` chain, listed in a plain array of classes (`REGULAR_ENEMIES` / `BOSSES` / `WEAPONS` / `AMMO_CLASSES`) — no `ENEMY_REGISTRY`, no generic `Goo`, no id→config table. Enemies/bosses put *behaviour* on the class (`server/src/entities/enemies` + `/bosses`); weapons (`shared/src/weapons`, three-level chain `Weapon → Sword/Bow/Staff/… → the weapon`) and ammo (`shared/src/ammo`, `Ammo → Arrow/Bolt/Boomerang → the ammo`) currently put only *stats* there, but being real classes means a specific one can grow a bespoke method later without reshaping anything. `WEAPON_REGISTRY` / `AMMO_REGISTRY` (id→template) are *derived* from `WEAPONS` / `AMMO_CLASSES` because both are referenced by id across the wire — a genuine lookup need, not a config shortcut. Still plain config in a `shared/` registry: **characters** (`CHARACTER_REGISTRY` — per-class maxHp/speed/defaultWeaponId); add one by adding a config + registry entry. Client visuals live in parallel registries (`client/src/characters`, `client/src/enemies`, `client/src/weapons`). Clients pass `characterClass`/`characterType` as join options, synced on `PlayerState` — both are UNTRUSTED and go through `resolveCharacterClass`/`resolveCharacterType` rather than being cast (an unknown class used to crash `onJoin`).

**Unified combat + spells.** All damage flows through one resolver (`server/src/combat/CombatSystem`): entities emit `HitSource`s during their tick, and it delivers an `Attack` to any `CombatTarget` whose `layer` the source's `affects` mask reaches (directional — see `docs/layers.md`). All abilities are one `Spell` type (`server/src/spells`) run by a shared `SpellCaster` — a boss move, an enemy attack, and a player's weapon swing/shot/AOE are the same shape (windUp→strike→active→recover, cooldown owned by the spell). Anything that casts implements the tiny `Caster` interface. **Add an attack/ability as a `Spell`, not a bespoke code path.**

**Melee hurtboxes are measured from the attack animation, not declared.** `assets/generate-fx-hurtboxes.js` reads the four FX strips (`slash`/`long-slash`/`stab`/`long-stab`), takes each frame's opaque-pixel bounds in the strip's body-anchor space, and writes `shared/src/weapons/fxHurtboxes.generated.ts`. `Weapon` derives its `getHurtbox` from its `fxType` (ranged/AOE weapons get `() => null`), so **there is no per-weapon reach number to drift** — new attack art gets a correct hitbox for free. Two consequences worth knowing: the hurtbox is **per-frame**, so it sweeps outward as the arc extends and the strips' empty leading frames become a real wind-up (a swing deals no damage for its first ~143ms); and the hitbox timeline follows the **animation's** frame rate, not the weapon's cooldown, so a slow weapon holds `isAttacking` after its hitbox is gone. The generated table is checked in — the authoritative server must never decode a PNG at runtime, and the client H overlay reads the same table so what it draws is exactly what the resolver tests. Re-run the generator after changing any FX strip.

**Weapon instances + the attack pipeline.** `WEAPON_REGISTRY` entries are immutable **templates**; what a player carries is a `WeaponInstance` (template + uid + its own `WeaponMod[]`), so two players' broadswords can genuinely differ. Damage is assembled in stages — template base → weapon-instance mods → **`Caster.scaleAttack`** → `Entity.takeHit` mitigation — rather than being a literal anywhere. `Entity` implements `scaleAttack` as the identity, so enemies/bosses are untouched and **`Player` is the only override**; that is what lets one upgrade reach every weapon, ability, and shot without any spell builder knowing modifiers exist. Stats fold as `(base + Σflat) × (1 + Σpct)` so pickup order never changes the result. **Add a stat modifier as an `Upgrade` or a `WeaponMod`, never by editing a damage number in a spell.** See [docs/upgrades.md](docs/upgrades.md).

**Upgrades are OO, like enemies.** One `Upgrade` subclass each (`server/src/upgrades`), contributions as compiler-checked zero-default getters, listed in `UPGRADES`. The `UpgradeId` union lives in `shared` (mirroring `EnemyType`) so the debug menu can offer them; `assertUpgradesCoverAllIds()` fails at boot if the union and the classes drift. Players hold them in `Player.upgrades` and fold them into their own stats — **consumers ask the Player, they don't sum upgrades themselves**.

**Loadout system** (inventory, switching, shops, pause) is server-authoritative and synced. Switching is an instant hotkey; the inventory menu pauses the whole room; the store is an in-world room and does *not* pause. See [docs/loadout.md](docs/loadout.md).

**Menus and debug floors**: `MenuScene` is the boot scene (Start / Options / Debug). All three paths end in `scene.start("GameScene", LaunchConfig)`, where `LaunchConfig.debug` is either `null` (real game) or a `DebugConfig`. The client passes that config as a Colyseus join option; `GameRoom.onCreate` turns it into `DungeonOptions` and stores the JSON in `GameState.dungeonOpts` so every client (including late joiners) generates the same map the server did. Debug rooms use `client.create()` rather than `joinOrCreate()` so they never matchmake into a room built with different options; P2–P4 then `joinById()`.

To add a debug knob: add the property to `DebugConfig` (`shared/src/debug.ts`) with a default, add one entry to `DEBUG_FIELDS` (`client/src/debug/debugFields.ts`), and read it in `GameRoom` (or map it into `DungeonOptions`). The panel renders itself from the field list — `FieldPanel.ts` never needs touching. `GameScene` and `MenuScene` are restartable, so anything they mutate is reset in `init()`/`create()`, not at field-initializer time.

**Room type system**: `dungeonGenerator.ts` assigns a `RoomType` (`"combat" | "maze" | "boss" | "shop" | "shrine" | "chest" | "wave" | "timed" | "dark"`) to each room during generation — before carving, so the carve function varies by type. Boss is placed first (random non-start room), then all others get a weighted roll (37% combat / 6% timed / 4% dark / 8% wave / 16% maze / 15% shop / 7% shrine / 7% chest). `RoomData.type` carries the type through to `GameRoom`, which uses it to decide enemy spawning (the reward rooms in `NO_RABBLE_ROOM_TYPES` get none; the boss room gets a single boss, not the usual rabble; **the start room never gets enemies** so players aren't jumped on load — the one exception is a degenerate single-room floor where start === exit). Boss passageway tiles are overwritten with `TILE.BOSS_FLOOR` (gold, breathing animation) after connections are built.

**Debug "showcase" floors**: picking a specific room type in the Debug menu with a 1×1 grid no longer builds a lone start-is-exit room. `toDungeonOptions` maps it to `DungeonOptions.showcaseRoomType`, and `generateDungeon` builds a fixed 3-room line — plain combat start → the chosen room → combat exit (with stairs) — so shop/shrine/boss rooms get tested with a real spawn point and a proper exit. A bigger grid still forces every room to the chosen type (`forceRoomType`) as before.

**Barriers are one-way, and that's a collision-filter trick, not geometry.** A room's `barrierParent` (blocking advance until the room is cleared) is a plain wall. Its `barrierChild` (blocking retreat once you're in) is **one-way**: latecomers walk in, nobody walks out — the rule the first playtest demanded, because a solid child barrier ejected any co-op partner who didn't cross the doorway in the same tick. Matter collision is symmetric, so "one-way" can't be a property of the body; instead the barrier sits on its own `Layer.BARRIER_EXIT` and **only a COMMITTED player's mask includes that bit** (`PhysicsWorld.setPlayerCommitted`, re-evaluated every tick from `FloorManager.isCommittedAt`). Commitment is tested on the room **interior**, which is inset a tile past the doorway the barrier occupies — that inset is load-bearing, since a player who gained the bit while overlapping the body would be squeezed out to an arbitrary side. Projectiles are not matter bodies and consult `physics.barrierAt()` instead, where both sides block: one-way applies to walking, not to arrows.

**Enemies don't exist until you walk in (deferred spawning).** The floor pass (`SpawnDirector.spawnFloorEnemies`) constructs every enemy up front — confined, party-scaled, registered with FloorManager so its room locks and is never pre-cleared — but holds each **unspawned** (`Enemy.markUnspawned`): out of the synced `state.enemies`, skipped by the AI and contact passes, and not a combat target (`damageable` is false while unspawned). `GameRoom.tick` reveals a room's whole batch at once (`SpawnDirector.spawnRoom`) the first time a player is inside it or in a passageway touching it (`FloorManager.occupiedRoomIds` — the same "both rooms of a passageway" trick, so creatures puff into view as you come through the doorway). Adding an enemy to `state.enemies` is what makes the client draw it, so the client plays a dust puff on every `enemies.onAdd` (`SpawnFX`) — no extra broadcast. `Enemy._spawned` defaults to **true**, so a summon (Tengu split) or an enemy built directly against a bare `PhysicsWorld` (unit tests) is active immediately, no FloorManager required.

This **replaced the old room-dormancy machinery** (an `awakeRooms` set that froze enemies in unwatched rooms): an enemy you have never reached simply does not exist yet, so nothing needs freezing, and once revealed it ticks normally forever. Kept separately: every enemy is **confined to its home room** (`Enemy.confineTo`, set at the one `SpawnDirector.addEnemy` choke point) — movement intent is clipped per-axis at the room's interior bounds, while knockback is deliberately *not* clipped (being blasted into a doorway is combat feel; the enemy walks itself back in). Confinement is why a revealed enemy still can't chase across the floor, and it's inert wherever no FloorManager set bounds, which is why a bare-`PhysicsWorld` test enemy wanders freely.

**Empty room finalization**: after `spawnFloorEnemies()`, `GameRoom` calls `floorManager.finalizeEmptyRooms()`, which marks all zero-enemy rooms as pre-cleared and removes their outgoing `barrierParent` barriers. Without this, the reward rooms (shop/shrine/chest) lock the player in forever (no enemies to kill = clear condition never fires). **`spawnBoss()` must run before `finalizeEmptyRooms()`** — it's called at the end of `spawnFloorEnemies()` for exactly that reason. Otherwise the boss room is pre-cleared and the boss never locks anyone in. Also, `FloorManager.checkPlayerEnteredRoom()` skips placing `barrierChild` for any room with no enemies — players can always retreat from empty rooms.

**Room challenges**: a room type can carry an objective beyond "kill what's here". `RoomChallenge` (`server/src/rooms/challenges/`) is OO like `Enemy`/`Upgrade` — one subclass per objective, picked by an exhaustive `switch` on `RoomType` in `GameRoom.challengeFor`, no id→config table. `GameRoom` holds `Map<roomId, RoomChallenge>` and mirrors each to `state.challenges` (`RoomChallengeState`: label + progress/goal, deliberately generic so new challenges need no schema change). The client renders that through `ui/ChallengeBanner`, keyed off the room cell the camera lock already computed.

Two exist. `WaveChallenge` (the "wave"/horde room): the opening batch comes from the ordinary rank-and-file pass, then it plays as **continuous attrition** rather than discrete waves — a fixed total (`enemiesPerRoom() × 3`) is fed in, and every kill spawns a replacement up to a concurrent cap (`enemiesPerRoom()`), until the reserve is spent and the last one falls. Its banner reads `Horde {slain} / {total}`. The room stays locked by the same tick-order trick: `onEnemyDown` runs *before* the clear check, so a just-spawned replacement is already in the room's set when "everything here is dying" evaluates. `TimedClearChallenge`: clear inside 45s and a reward pedestal drops. **Running the clock out is deliberately NOT a failure** — the game has no failure state and inventing one here would be the first thing in the dungeon able to strand a party. The timer is a bonus condition; miss it and the room clears normally, you just get no pedestal. The clock also doesn't start until a player is actually in the room, or it would drain while the party is three rooms away. **`FloorManager` needs no special case, and the reason is tick ordering** — `challenge.onEnemyDown()` runs *before* `floorManager.onEnemyMaybeCleared()` in tick step 4, so the fresh wave is already in the room's set when the "everything here is dying" test evaluates and the room stays locked on its own. Move that call after the check and the door pops open for a frame on every wave break. Step 4 also collects dying ids before iterating for the same reason summons are deferred in step 3: a challenge spawning enemies would mutate `this.enemies` mid-`forEach`.

**Dark rooms are client-only.** `type: "dark"` is an ordinary combat room on the server — no challenge, no schema field, nothing in `GameRoom`. The whole variant is `client/src/map/DarknessOverlay.ts`, which the client can decide on alone because it regenerates the same dungeon from the same seed (the camera room-lock works the same way). Enemies see and aggro normally; you just can't see them. The generator gives dark rooms **no cover blocks** — invisible cover is only something to snag on. **Gotcha the overlay documents: `setScrollFactor(0)` does not exempt an object from camera zoom.** At the default 2× a screen-space overlay renders double-size and displaced, which is why the darkness is anchored in world space over the room instead.

**Trap tiles**: `TILE.TRAP` warps the whole party `TRAP_MIN_FLOORS`–`TRAP_MAX_FLOORS` floors forward — you skip those floors' loot, shops and shrines while the difficulty climbs anyway. It's rendered in plain sight so stepping on one is a mistake, not a coin flip. Placement happens **last** in `generateDungeon` (step 8), which is what makes it safe: only tiles still plain `TILE.FLOOR` are eligible, so it can never eat the stairs or a boss passageway, and the margins keep it off doorways and out of the room center where props live. It is placed with the **seeded rng**, not `Math.random` — the client generates its own map, so a trap rolled server-side only would desync. Because the rolls happen after all other geometry, adding them did not change any existing seed's layout. `GameRoom` watches for it in the tick's stairs step and calls `advanceFloor(steps)`; `stairsActive` gates both paths, so two players landing in the same tick still only advance once.

**Stairs are never covered**: the stairs go at the exit room's center tile, which is also where a shop lays its middle pedestal. Two rules keep them clear. `dungeonGenerator.ts` picks the exit room as the farthest room from start whose type is not in `STAIRS_AVOID_TYPES` (`shop`, `shrine`, `chest`) — add any future prop-placing room type to that list. And `GameRoom.spawnShops()` nudges each pedestal to the nearest plain-`FLOOR` column on the center row, which covers the fallback case where a forced-room-type debug floor makes *every* room a shop. Also: when start === exit (a single-room floor) the player would spawn on top of the stairs and descend instantly, so `generateDungeon` steps the spawn to the nearest open tile.

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
| Weapon (damage, cooldown, force, fxType) | `shared/src/weapons/<category>/<id>/index.ts` (or category `base.ts`) |
| Melee swing geometry (reach, arc, wind-up timing) | **the FX art itself** — edit the strip in `assets/`, re-run `node assets/generate-fx-hurtboxes.js`. Never hand-tuned; see the note below |
| Staff feel (which element, fire rate) | the staff's `ammoId` + `attackCooldownMs`; the bolt's damage/speed/pierce live in `shared/src/ammo/bolts/<id>/index.ts` |
| Ammo/projectile (damage, speed, pierce, hit ellipse, spin/return) | `shared/src/ammo/<id>/index.ts` |
| Enemy hurt size (what you can hit) | **the sprite art** — replace the PNG, run `npm run assets:hurtboxes`. Never hand-tuned |
| Enemy (hp, speed, aggro, attack, knockback resistance, flying height) | stat getters on the `Enemy` subclass — `server/src/entities/enemies/<group>.ts` (a flyer overrides `cruiseHeight`) |
| Boss (moveset, movement, phases, stats) | the `Boss` subclass — `server/src/entities/bosses/<Name>.ts` (spells from `server/src/spells`) |
| Upgrade effects (+HP/+speed/+damage/+armor/+lifesteal, floor gating) | the `Upgrade` subclass — `server/src/upgrades/stats.ts` |
| Weapon-modifier rolls (what can land on a rewarded weapon, how it scales) | `server/src/upgrades/weaponMods.ts` (`rollWeaponMod`) |
| Reward pedestals (shrine vs boss mix, choice count) | `rollOffer` / `OFFER_CHOICES` in `server/src/rooms/LootDirector.ts` |
| Chests (gold rarity, how many modifiers each tier rolls) | `GOLD_CHEST_CHANCE` / `*_CHEST_MODS` in `server/src/rooms/LootDirector.ts` |
| Traps (spawn rate, which rooms, placement margins) | `TRAP_ROOM_CHANCE` / `TRAP_AVOID_TYPES` / `TRAP_*_MARGIN` in `shared/src/dungeonGenerator.ts`; warp depth is `TRAP_MIN/MAX_FLOORS` in `shared/src/types.ts` |
| Store (pedestal count, HP cost formula, buy radius) | `server/src/rooms/LootDirector.ts` |
| Enemy spawn counts / pools / boss placement | `server/src/rooms/SpawnDirector.ts` |
| Loadout keybinds / acquire freeze | `client/src/input/InputSource.ts`, `ACQUIRE_MS` in `entities/AcquireFX.ts` |
| Knockback / hitstun feel, tick rate, enemy count, body geometry | `shared/src/types.ts` |
| Debug-menu knobs and presets | `client/src/debug/debugFields.ts` (+ `shared/src/debug.ts`) |
| Client options (camera zoom, overlays) | `client/src/options/gameOptions.ts` |

For ranged weapons the ammo carries the base damage and the weapon's own `damage` is a **flat bonus added on top** (so a weapon modifier works the same on a bow as on a sword). Speed/pierce still live entirely on the ammo. Most ranged weapons declare `damage: 0` and contribute only fire rate + which `ammoId`.

## How to change things

### Add a tile type
1. Add ID to `TILE` const in `shared/src/types.ts`
2. Add its `TileProps` to `TILE_PROPS` in the same file
3. Map it to a tileset frame in `TileRenderer.ts` → `TILE_TO_FRAME` (add the frame to `assets/dungeon-tiles.png` first if it needs new art, then `npm run assets:build`)
4. Emit the new ID from the carve logic in `shared/src/dungeonGenerator.ts`

### Change the map
The map is **generated, not hand-authored**: `generateDungeon(seed)` in `shared/src/dungeonGenerator.ts` builds a 5×4 grid of 21×16-tile rooms (105×64 tiles total) with a seeded RNG. Client and server both call it with the same seed, so they always agree — no map sync. To get a different floor-1 layout, change `MAP_SEED` in `shared/src/tileData.ts` (each stairs descent regenerates with `seed + 1`). To change the *structure* — room sizes, carve shapes, connection rules — edit `dungeonGenerator.ts` itself: `generateDungeon` is a short pipeline of named phases (buildRoomGraph → growToMinRooms → assignRoomTypes → carveRooms → carveDoorways → carveEntryCorridors → buildConnections → pickExitAndSpawn → stampBossPassage → placeTraps), so edit the phase rather than a 380-line function.

⚠️ **Determinism is the contract.** Client and server each generate the floor from the same seed, so any change that consumes rng draws in a different ORDER changes every existing seed's map and can desync the two mid-migration. Adding a phase that draws from `rng` is a map change even if it "only adds" something. Verify by dumping `generateDungeon` output for a few hundred seeds plus the option variants (showcase / forceRoomType / single-room / oversized grid) before and after, and diffing. When touching room geometry, note that `roomCellAt` (which grid cell a point is in) and `roomInteriorContains` (is it really inside, excluding the 1-tile border ring) are deliberately separate questions — the camera wants the first, FloorManager the second, and the border inset is load-bearing because doorway tiles punch through it.

### Add an enemy, a weapon, or art
See [docs/enemies.md](docs/enemies.md), [docs/weapons-and-ammo.md](docs/weapons-and-ammo.md), [docs/assets.md](docs/assets.md). Use those recipes, not the generic entity steps below.

### Add a character class or character skin
Classes (gameplay) and character types (visuals) are separate axes, both picked as Colyseus join options:
- **New class** (stats + starting weapon): `shared/src/characters/<Class>.ts` with a `CharacterConfig` → add to the `CharacterClass` union in `base.ts` + `CHARACTER_REGISTRY` in `index.ts`. No client-side registry entry needed — attack FX comes from the weapon.
- **New skin** (spritesheet): drop a PNG following the 15×4 humanoid layout in `assets/`, run `npm run assets:build`, add to `CHARACTER_TYPES` (`shared/src/characters/base.ts` — the union derives from it) and `CLIENT_CHARACTER_VISUAL_REGISTRY` — `GameScene` preloads/defines from the registry automatically.

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

### Add an upgrade or a weapon modifier
Both are OO, like enemies — see [docs/upgrades.md](docs/upgrades.md). An **upgrade** is an `Upgrade` subclass in `server/src/upgrades/stats.ts` overriding only the stat getters it affects, plus its id in the `UpgradeId` union (`shared/src/upgrades.ts`) and one line in `UPGRADES`. A **weapon modifier** is a `WeaponMod` subclass in `server/src/upgrades/weaponMods.ts` plus a case in `rollWeaponMod`. Neither needs a schema change, and neither should ever become a keyed config table.

### Add a new room type (e.g. lobby, dungeon level)
Define a new `Room` subclass in `server/src/rooms/`, register it in `server/src/index.ts` with `gameServer.define()`, and connect to it by name from the client via `client.joinOrCreate("room-name")`.

## Gotchas

- **Tile coordinates vs pixel coordinates**: tiles are 32×32 px. `entity.state.x/y` are pixel coords. To get tile: `Math.floor(x / TILE_SIZE)`. Spawn points are set as `col * TILE_SIZE + 16` (center of tile).
- **Server physics is matter-js** (`server/src/physics/PhysicsWorld.ts` — the only file that imports it). Each entity is a radius-5 circle at the sprite's *feet* (`body.y = state.y + FOOT_OFFSET(8)`); schema `state.x/y` stays the sprite center. (`ENTITY_RADIUS`/`FOOT_OFFSET` are defined in `shared/src/types.ts` and re-exported from PhysicsWorld, so the client **H** debug overlay can draw the true collision circle.) Movement: `Entity.move()` records px/sec intent → GameRoom calls `commitVelocity()` (converts px/sec ÷ 60 to Matter's per-16.667ms velocity units — get this wrong and everything moves ~3× off) → `Engine.update(50)` → `syncFromBody()`. Who-collides-with-whom is each body's `layer`/`solidMask` (from its `InteractionProfile` in `shared/src/layers.ts` — currently every body blocks WALL|PLAYER|ENEMY). `ENTITY_RADIUS` must stay ≤ ~14 or one-tile 32px gaps close. Melee `attackRadius` getters on enemy classes are center-to-center and must exceed `2 × ENTITY_RADIUS` (10px) or attacks silently never land against rigid separation — that's why the goos use `attackRadius: 14`. Dying enemies get a WALL-only collision mask via `setEntityDead()` (corpses don't block). All teleports go through `Entity.teleport()` (never assign `state.x/y` for position changes — the body won't follow).
- **Walking bounds and hurt bounds are separate, and both are MEASURED FROM ART.** `ENTITY_RADIUS` (5px, at the feet) is what an entity *collides* with. What it can be *damaged* on is its drawn sprite — a per-creature **box** (`halfW`/`halfH` + an offset from the sprite centre) in `shared/src/enemies/hurtBounds.generated.ts`, produced by `assets/generate-enemy-hurtboxes.ts` from the spritesheets. These used to be conflated in the worst way: hurt bounds defaulted to **0**, so every creature was a bare point at its centre and a swing had to cross that exact pixel. There is **no hand-tuned hurt size anywhere** — `Enemy.hurtBounds` reads `ENEMY_HURT_BOUNDS[typeId]`, `Player` reads `PLAYER_HURT_BOUNDS` (the union across all 12 skins, so a costume can't change how hittable you are). It's a box rather than a radius because the art isn't square: the spider measures 30×15, the batwing boss 80×64. Three things to know: bounds are the **union of each enemy's own frames** (a creature must not dodge by animating, and shared sheets like the three float-skull rows each get their own bounds); the resolver tests `shapeHitsBox`, which is **exact for rect and circle** (melee arcs, contact, AOE) and falls back to the box's circumradius for `segment`/`sweptEllipse` (documented, errs inclusive); and an enemy's `attackRadius` (center-to-center) subtracts `PLAYER_HURT_BOUNDS.halfW` in `contactHitSource`, or real hurt bounds would silently hand every enemy extra grab range.
- **Sprite geometry lives in `client/src/enemies/spriteGeometry.ts`, and it is Phaser-free on purpose.** Cell size, which frame indices an enemy uses, and display size are there rather than inline in the visual defs because the hurtbox generator has to import them — requiring the visual defs in Node throws `window is not defined` the instant Phaser loads. The factories read that table, so the client cannot render one layout while the server hit-tests another. `Record<EnemyType, …>` means a new enemy without geometry is a compile error.
- **Enemies stay dead — there is no respawn.** Cleared rooms stay cleared; everything is wiped and respawned fresh only when `advanceFloor()` regenerates the floor. Details in [docs/enemies.md](docs/enemies.md).
- **Camera is room-locked (Zelda-style)**: every frame, `GameScene.update()` snaps `camera.setBounds()` to the 21×16-tile room containing the local players' centroid, at 2× zoom, then `centerOn(centroid)`. Crossing a doorway hard-cuts the camera to the next room. Split-screen for spread-out local players is still an open idea.
- **Colyseus schema fields can hold data, not behaviour** — and an UNDECORATED property on a `Schema` is a legitimate place for server-only state. `OfferChoiceState.mods` holds the rolled `WeaponMod` objects with no `@type`, so it never serializes: a modifier's value is getters, `@type` takes only primitives/Schemas, and rebuilding one client-side would need the forbidden id→class map. Colyseus preserves the property through `ArraySchema.push` (verified). Use this rather than a parallel `Map` when the state's lifetime is the synced object's lifetime — but comment it, because a mixed synced/unsynced object misleads readers.
- **The client reads room state through typed VIEWS, and renaming a synced field is now a compile error.** `shared/src/stateViews.ts` describes each schema's synced shape, and every server schema declares `implements <View>` — so dropping or renaming a `@type` field the client reads fails the **server** build (`TS2420`), not silently at runtime 20 files away. This replaced the old `pState: any` hazard (`PlayerState.inventory` → `weapons` once hit exactly that). Two rules when you touch it: the views carry **synced fields only** — a deliberately undecorated property (`OfferChoiceState.mods`, `ChestState.weaponId`/`mods`) must never appear there, since the client would be typed to read `undefined` — and `room.state` still needs its one documented cast per boundary, because colyseus.js hands over untyped decoded state.
- **Anything diffing a player's weapons must key on the instance `uid`, not the weapon id** — duplicates of the same weapon are legal now that weapons are instances, so an id-based `includes()` check silently swallows the second pickup. Same trap in `InventoryHud`'s change-detection signature, which builds from uids because `join(",")` over objects yields `[object Object]` for every slot and would compare equal forever.
- **No persistence**: all state is in-memory. Server restart = everyone disconnects and rejoins fresh.
