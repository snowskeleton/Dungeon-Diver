# Refactor Plan — "make it beautiful"

A design-review pass over the whole codebase (2026-07-19, everything through the
Floor 5 room variants). The goal of every item here is *expansion-readiness*:
missing abstractions, needless duplication, and mental models that will bite the
next feature. This is not a bug list — the game works.

**Ground rules for whoever executes this:**

- Read CLAUDE.md's engineering-approach note first. MIT style: no lookup tables
  for behaviour, no stringly-keyed dispatch, compiler-checked everywhere possible.
- Work one item at a time, each as its own commit.
- Before touching anything on the server combat path, run `npm test`; it must stay
  green after the change. (This replaced a golden byte-identical `verify-boss.ts`
  baseline, which pinned HP/damage totals and broke on every balance pass. Run after every
  server change.
- These are *refactors*: observable behaviour must not change unless an item
  explicitly says otherwise. If a change would alter a seeded dungeon layout,
  that's behaviour — don't.

**Explicitly NOT broken — do not "improve":** the Spell/SpellCaster/Caster
system, the CombatSystem resolver, the attack pipeline (scaleAttack/takeHit
stages), the Upgrade/WeaponMod OO design, the WeaponInstance model, the
Entity effect-buffer (drainEffects) pattern, and the OO enemy/boss classes.
These are the load-bearing good ideas; every item below works *toward* their
style, not away from it.

---

## Tier 1 — structural (do these first, in order)

### 1. Break up the GameRoom god object

`server/src/rooms/GameRoom.ts` (924 lines) owns five jobs: Colyseus lifecycle,
the tick loop, **loot** (shops + offers + chests), **spawning** (rabble + boss +
summons), and floor advancement. Every future feature lands here by default,
which is how god objects grow. Split it into collaborators that GameRoom owns
and delegates to — plain classes, constructed in `onCreate`/`initFloor`, no
Colyseus coupling inside them:

- **`rooms/LootDirector.ts`** — everything reward-shaped: `spawnShops`,
  `spawnShrineOffers`, `spawnChests`, `rollOffer`, `rollWeaponChoice`,
  `dropBossOffer`, `dropChallengeReward`, `rollShopWeapons`, `freeShopCol`, and
  the three message handlers' *validation+grant* logic (`buy`, `offerPick`,
  `chestOpen`). GameRoom keeps the `onMessage` registrations one line each:
  look up the player, call `loot.buy(player, msg)`. Note the three handlers
  share an identical proximity check — extract a private
  `isNear(player, x, y)` using `BUY_RADIUS` once.
  Constants that move with it: `SHOP_ITEM_COUNT`, `OFFER_CHOICES`, `BUY_RADIUS`,
  `GOLD_CHEST_CHANCE`, `*_CHEST_MODS`. It needs: the `GameState` (to write
  `shops/offers/chests`), the current `DungeonResult`, and the floor number.
  Update CLAUDE.md's "Where balance lives" table to point at the new file.
- **`rooms/SpawnDirector.ts`** — `spawnFloorEnemies`, `spawnBoss`, `bossPos`,
  `spawnEnemyInRoom`, `summonEnemy`, `enemyPool`, `enemiesPerRoom`,
  `hasCustomEnemyList`, `roomInterior`, `randomPosInRoom`, plus the
  `enemyCounter`. While doing this, collapse the three near-identical
  spawn bodies (`spawnBoss` / `spawnEnemyInRoom` / `summonEnemy` all do
  "mint id → `new Cls` → `enemies.set` → `state.enemies.set` →
  `floorManager.assignEnemy`") into one private `addEnemy(Cls, x, y): Enemy`
  the three call.
- GameRoom keeps: lifecycle, input/pause handlers, `tick()`, `advanceFloor`,
  `initFloor`, the challenge plumbing (it's small and tick-ordering-critical),
  and `spawnProjectile` (it's the drain target).

Verification: all three verify scripts, then a manual run (start `npm run dev`,
buy from a shop, open a chest, claim a shrine offer, kill a boss, descend).
The tick's step ordering must be preserved *exactly* — the comments in `tick()`
document why (challenge-before-clear-check, summon deferral).

### 2. Decompose `generateDungeon`

`shared/src/dungeonGenerator.ts` — `generateDungeon` is a 380-line function with
8 numbered phases held together by shared locals. Extract each phase into a
named function taking/returning explicit data (the phases already have names:
`buildRoomGraph`, `growToMinRooms`, `assignRoomTypes`, `carveRooms`,
`carveDoorways`, `buildConnections`, `pickExitAndSpawn`, `stampBossPassage`,
`placeTraps`). `generateDungeon` becomes a ~30-line pipeline you can read top
to bottom.

Two things to fix while in there:

- **The 4-way copy-paste in step 6.** The four `ConnectionData` literals differ
  only by axis and sign. Write one `makeConnection(parent, child, dir)` that
  computes passageway bounds and both barrier rects from the direction; the BFS
  calls it once. (Same knowledge is duplicated again in step 4's doorway
  carving — share a small `doorwayTiles(parent, dir)` helper if it falls out
  naturally, but don't force it.)
- **The cumulative-weight table.** `ROOM_TYPE_WEIGHTS` stores hand-summed
  cumulative percentages — editing one weight means recomputing every row, and
  nothing checks they end at 100. Store plain weights
  (`{ type, weight }[]`), compute the total at module load, and roll against
  that. Same behaviour for the same rng draws.

⚠️ **Determinism is the whole contract here.** The refactored generator must
consume rng draws in *exactly* the same order, or every seed's map changes and
client/server desync becomes possible mid-migration. Verification: before the
change, dump `JSON.stringify(generateDungeon(s).mapData)` for seeds 1–200 to a
file (a 10-line throwaway script); after, diff. Also run `npm test`.

### 3. Type the client's view of the schema (kill the `any` states)

CLAUDE.md documents the trap: `pState: any` in `GameScene.setupWorldSync` means
a schema rename silently reads `undefined`. That's a missing abstraction, not a
fact of life. Fix:

- Add `shared/src/stateViews.ts`: read-only interfaces describing the synced
  shape of each schema — `PlayerStateView`, `EnemyStateView`,
  `ProjectileStateView`, `ShopItemStateView`, `OfferStateView`,
  `ChestStateView`, `RoomChallengeStateView`, `GameStateView` (with the typed
  `MapSchema`-ish collections expressed as
  `{ onAdd(cb): void; onRemove(cb): void; get(id): T | undefined; forEach(...) }`
  plus the scalar fields). Fields only — no methods beyond the sync callbacks.
- Make each server schema class declare `implements <View>` (e.g.
  `class PlayerState extends EntityState implements PlayerStateView`). Now a
  rename that isn't mirrored in the view is a **server-side compile error**.
- Replace every `: any` state parameter in `GameScene`, `LocalPlayer`,
  `InventoryHud`, `InventoryMenu`, `OfferPicker`, `ChallengeBanner` (grep the
  client for `: any`) with the view types.

This is the highest value-per-line change in the plan: it converts the
project's most dangerous documented gotcha into a compile error. Verification:
`npx tsc --noEmit` in both workspaces, then a full manual co-op smoke run.

### 4. Give client entities object arguments instead of positional `setTarget` sprawl

`EnemyEntity.setTarget` takes 10 positional arguments; `RemotePlayer.setTarget`
7; `LocalPlayer.syncFromServer` 7. This violates the project's own style rule
and makes adding a synced field a 4-file mechanical edit. Once item 3 exists,
pass the typed view itself: `setTarget(state: EnemyStateView)` — the entity
reads the fields it wants. The `onChange` wiring in `GameScene` collapses to
`enemyState.onChange(() => e.setTarget(enemyState))`. Do the same for the
constructor "initial values" bundles. No behaviour change; verify by smoke run
(move, attack, watch a boss telegraph, watch a flyer's airHeight).

---

## Tier 2 — real design fixes, independent of each other

### 5. Client weapon visuals: one interface, one class per style

`client/src/entities/Entity.ts` holds five parallel optional fields
(`fxSprite`+`fxType`, `weaponIconImage`, `bowSprite`+`rangedWeaponId`,
`castSprite`, `novaFx`) and three methods (`configureWeaponVisuals`,
`swapWeapon`, `updateAttackFX`, plus `syncSpritePosition`) that each branch over
which combination exists. That's a sum type flattened into nullable fields —
the exact shape the engineering note says to avoid. Replace with:

```ts
interface WeaponVisual {
  sync(x: number, y: number, facing: Facing): void;  // follow the owner
  playAttack(x: number, y: number, facing: Facing): void;
  destroy(): void;
}
```

One class per style, each wrapping the existing helper modules (they stay):
`MeleeSwingVisual` (FX strip + icon), `HeldBowVisual`, `HeldStaffVisual`,
`NovaVisual`, `NoVisual` (thrown). A single `weaponVisual: WeaponVisual` field;
`configureWeaponVisuals` becomes a factory function (an exhaustive `switch` on
`rangedStyle`/`fxType`); `swapWeapon` is `destroy()` + factory. Entity's anim
path calls `sync`/`playAttack` unconditionally. Verification: visually attack
with a sword, bow, staff, thrown knife, and the debug nova; switch weapons
mid-run.

### 6. Extract the HUD out of GameScene

`GameScene` builds and updates `hpText`, `floorText`, `pausedText`,
`storeCard`, and the controls hint inline — plus `updateStoreCard` logic. Move
these into a `ui/GameHud.ts` class (constructed with the `UiLayer`, one
`update(...)` method taking what it renders). This shrinks GameScene toward its
actual job (scene lifecycle + world sync + camera) and gives HUD work a home.
Follows the existing pattern of `InventoryHud`/`ChallengeBanner`. Pure move;
verify by smoke run.

### 7. Cache the client's `DungeonResult` instead of regenerating

`GameScene` calls `generateDungeon` in `rebuildMap`, again in `create()` for
the spawn point, again in the `P`-key handler, and again in the
`connections_child_locked` handler. Same seed+opts every time — it's cheap, but
it encodes a wrong mental model ("the dungeon is a function you call") instead
of the right one ("the scene holds the current floor's dungeon"). Store the
`DungeonResult` from `rebuildMap` in a field (`this.dungeon`) and read
`playerSpawns`/`connections` from it everywhere. This also removes the quiet
risk of a handler regenerating with a stale seed field mid-floor-change.

### 8. Unify room lookup: one grid-math implementation

Three places independently answer "which room is this point in":
`FloorManager.roomAt` (linear scan over rooms with an interior-inset test),
`GameScene.update` (inline `Math.floor(x / (ROOM_W * TILE_SIZE))`), and the
room-id format `"gx,gy"` that both rely on. Put one function in shared —
`roomCellAt(x, y): { gx, gy, id }` and `roomInteriorContains(room, x, y)` —
next to `RoomData` in `dungeonGenerator.ts`, and make both callers use it.
FloorManager keeps its map from id→RoomData for the membership answer, but the
geometry lives once. (Keep the *interior-inset* semantics of `roomAt` — the
1-tile border exclusion is load-bearing for passageway protection; the shared
helper should expose both "which cell" and "inside interior" as distinct
questions, because the client wants the former and FloorManager the latter.)

### 9. FloorManager: name the barrier concept

`FloorManager` manipulates barriers through four parallel primitives
(`barrierParentActive`/`barrierChildActive` maps, `"bp_"`/`"bc_"` string-prefixed
physics ids, per-call `addBarrier`/`removeBarrier`) and repeats the same
"loop connections, filter by room+active, remove, collect id" block five times
across `finalizeEmptyRooms` / `onEnemyMaybeCleared` / `releaseAbandonedRooms` /
`checkPlayerEnteredRoom` / `dispose`. Introduce a tiny private `Barrier`
abstraction: one map `Map<connId, { parent: boolean; child: boolean }>`, and
two private methods `raise(conn, side)` / `drop(conn, side): boolean` that own
the physics-id naming and the active-flag bookkeeping. Each public method
becomes a readable loop of `drop(...)` calls. External behaviour and the
returned connection-id arrays must be unchanged (the client keys overlays on
them). Verify with `tests/server/challenges.test.ts` plus a manual wave-room run (barriers are
the subtlest interaction with challenges).

### 10. Remove the enemy-tick cast and narrow what enemies see

`GameRoom.tick` step 2 builds `visiblePlayers` and passes it with
`as unknown as Map<string, PlayerState>` — a cast to the type it already is
(delete the cast; it compiles). The deeper issue: enemy AI consumes the raw
wire schema (`PlayerState`) when all it reads is `x`/`y` (grep
`server/src/entities` for `players.` usage to confirm before narrowing).
Define in `server/src/entities/Enemy.ts`:

```ts
export interface TargetInfo { x: number; y: number }
```

and change `tick(players: Map<string, TargetInfo>, ...)` /
`closestPlayer(players: Map<string, TargetInfo>)`. `PlayerState` satisfies it
structurally, so GameRoom changes only its type annotation. This is the seam
future AI (e.g. "prefer the weakest player" would add `health` to TargetInfo —
deliberately, visibly) grows through, instead of reaching deeper into the
schema. `npm test` must stay green (see `tests/server/bosses.test.ts`).

### 11. `rollShopWeapons` should return `WeaponId[]`

`GameRoom.rollShopWeapons` returns `string[]`, forcing casts at both call
sites (`as WeaponId` in `spawnChests`, implicit in `rollWeaponChoice`). Type it
`WeaponId[]` (`Object.keys(WEAPON_REGISTRY) as WeaponId[]` once, at the top)
and delete the downstream casts. Do this as part of item 1's LootDirector move.

---

## Tier 3 — small consistencies (batch into one or two commits)

### 12. Pedestal-placement duplication

`dropChallengeReward`, `spawnShrineOffers`, and `spawnChests` all compute
"center-row pedestal position via `freeShopCol`" with the same
`col * TILE_SIZE + TILE_SIZE / 2` arithmetic. After item 1, give LootDirector a
`pedestalPos(room): { x, y }` helper all three call. Also: the codebase writes
`tile * TILE_SIZE + TILE_SIZE / 2` in at least six files — add
`tileCenter(col, row): { x, y }` to `shared/src/types.ts` next to `TILE_SIZE`
and use it in the files this plan already touches (don't do a global sweep;
adopt it opportunistically).

### 13. `GameScene` barrier-overlay maps → one small view class

`barrierParentOverlays`/`barrierChildOverlays` plus `buildBarrierImages` plus
three message handlers that destroy-and-delete are a hand-rolled entity view.
Fold into a `map/BarrierOverlays.ts` class with `showParent(conn)`,
`showChild(conn)`, `hideParent(connId)`, `hideChild(connId)`, `clear()`. The
message handlers become one-liners, and `rebuildMap` calls `clear()`.

### 14. Duplicate respawn/spawn-assignment loops in GameRoom

`advanceFloor` and tick step 10 both walk players assigning
`spawns[i++ % spawns.length]` + teleport + full heal. Extract
`respawnAt(player, spawnIndex)` (or a `respawnAll(players)` on GameRoom) so the
"respawning means full heal at a spawn point" rule lives once.

### 15. `Boss.facing` cast

`Boss` has `get facing(): Facing { return this.state.facing as Facing; }` — if
`EnemyState.facing` is typed `string`, tighten the schema-side property type to
`Facing` (the decorator still serializes it as a string) and delete the cast
here and any siblings (grep for `as Facing`).

---

## Deferred design questions (need a human decision, not a refactor)

Recorded so they don't get "fixed" casually:

- **Client-side prediction / interpolation model.** LocalPlayer renders its own
  input while the server simulates; there's no formal reconciliation. Fine at
  LAN latencies, and changing it is a feature, not a cleanup.
- **`GameScene` vs. multiple Colyseus connections.** One-connection-per-local-
  player is a deliberate architecture choice; the observer-room pattern is its
  cost. Leave it.
- **Puzzle rooms** — already deferred by design (see memory/roadmap); nothing
  here should pre-build abstractions for them.
- **Split-screen camera** for spread-out local players — open idea in CLAUDE.md,
  untouched by items 6–8, which only *organize* the current camera/HUD code.
