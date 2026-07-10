# Inventory, weapon switching, store & pause

Read this before touching the inventory, shops, pause, or the acquire flourish.

Players own **multiple** weapons and swap between them; new ones are bought in shops. All of it is **server-authoritative** (the active weapon drives server hitboxes/damage/cooldown, and HP-cost purchases can't be client-trusted) and synced to clients.

## Inventory lives on `Player`

(`server/src/entities/Player.ts`) `inventory: string[]` + `activeIndex`, and `get weapon()` returns the active slot — so every existing `player.weapon` read transparently follows the active weapon.

- `switchWeapon(delta)` wraps the index, and does **not** reset `attackCooldown` (no switch-to-refresh-cooldown cheese)
- `addWeapon(id)` dedupes and returns whether it was newly acquired
- `spendHp(amount)` floors at 1

Synced via `PlayerState.inventory` / `activeWeaponIndex` / `weaponId` (=active, so remote weapon-visual swaps key off the existing field).

## Switching is an instant hotkey — no menu, no pause

Per input source (`InputSource.readActions()`, edge-detected in `LocalPlayer`): P1 `Q`/`E`, P2 `[`/`]`, gamepad L1/R1. Client sends `switchWeapon`; on the synced active-weapon change, `LocalPlayer`/`RemotePlayer` call `Entity.swapWeapon()` to tear down + rebuild the FX/bow/icon sprites (`configureWeaponVisuals`), and `LocalPlayer` replicates the server's facing-lock rule so it stays in sync with no round-trip.

## Pause = the inventory/stats menu only, and it freezes the WHOLE room for everyone

`LocalPlayer` toggles `InventoryMenu` (DOM overlay, `ui/InventoryMenu.ts`) with `I` (P2 `\`), sends `setPause`; `GameRoom` tracks `pausedBy: Set<sessionId>` and **early-returns at the top of `tick()`** while non-empty (message handlers still run, so you can switch/close while paused). `GameState.paused` drives the client PAUSED overlay. Cleared on `onLeave` so a disconnect-while-paused can't freeze the room forever.

## The store is an in-world room, NOT a menu — it does NOT pause

Each `shop` room gets `GameState.shops[roomId]` (a `ShopState` with `ShopItemState[]` pedestals, rolled per floor in `GameRoom.spawnShops()`, cleared/rebuilt on floor change). Weapons rest on pedestals at world positions; you walk up and press interact (P1 `F`, P2 `.`, gamepad Y) to buy.

Buying spends **HP from a shared team pool** (per the roadmap — *no gold system*). `GameRoom`'s `buy` handler validates:
1. proximity (`BUY_RADIUS`)
2. unsold
3. `HP > cost` (never lethal)
4. **that the buyer doesn't already own it** (else it'd waste HP and consume a pedestal a teammate might want) — via `addWeapon`'s return

then `spendHp` + marks `purchased` (shared → gone for all). Client renders pedestals as `ShopItemEntity` and shows a stats card when P1 stands on one.

## Acquire flourish

(`entities/AcquireFX.ts`) `LocalPlayer.syncFromServer` diffs the synced inventory; any newly-present id fires the Zelda "item get!" flourish (icon pops above the head + centered `weaponStatLines` panel) and briefly **freezes that player's input** — safe because acquisition happens in the enemy-free shop; revisit if weapons are ever granted mid-combat. Seeded from the starting weapon so joining doesn't fire it.

## Preloading

**All weapon icons/FX are preloaded up front** (`GameScene.preload()` loops the whole `WEAPON_REGISTRY`), so any bought/swapped weapon renders without lazy-loading.

## Balance

- **Store** → `GameRoom.ts` (top-of-file consts + `spawnShops()`): `SHOP_ITEM_COUNT` (pedestals per shop, currently 3), the HP `cost` formula (currently `clamp(round(damage × 1.4), 8, 30)`), and `BUY_RADIUS` (40 — must match `SHOP_BUY_RADIUS` in `LocalPlayer.ts`). Items are rolled uniformly from `WEAPON_REGISTRY`.
- **Loadout keybinds / acquire feel** → keys are centralized in `InputSource.ts` (switch/menu/interact per source); the acquire-freeze duration is `ACQUIRE_MS` in `entities/AcquireFX.ts`.
