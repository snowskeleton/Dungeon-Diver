# Inventory, weapon switching, store & pause

Read this before touching the inventory, shops, pause, or the acquire flourish.

Players own **multiple** weapons and swap between them; new ones are bought in shops. All of it is **server-authoritative** (the active weapon drives server hitboxes/damage/cooldown, and HP-cost purchases can't be client-trusted) and synced to clients.

## The weapon list lives on `Player`

(`server/src/entities/Player.ts`) `weapons: WeaponInstance[]` + `activeIndex`, and
`get weapon()` returns the active slot — so every existing `player.weapon` read
transparently follows the active weapon.

It holds **instances, not registry templates**: each carries its own modifiers, so two
players — or two slots — holding "a broadsword" can differ. Duplicates are legal.
See [upgrades.md](upgrades.md). It's named `weapons` rather than `inventory` because
other item lists (consumables, key items, equipment) are expected to sit beside it as
their own typed lists.

- `switchWeapon(delta)` wraps the index, and does **not** reset the attack (no
  switch-to-refresh-cooldown cheese)
- `addWeapon(template, mods?)` mints an instance with a fresh uid and returns it
- `ownsUnmodified(templateId)` — "already have a plain one of these?", used by the shop
- `spendHp(amount)` floors at 1

Synced via `PlayerState.weapons` (an `ArraySchema<WeaponSlotState>` of **resolved**
stats + mod labels) / `activeWeaponIndex` / `weaponId` (=active, so remote
weapon-visual swaps key off the existing field).

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
4. **that the buyer doesn't already own an unmodified copy** (else it'd waste HP and consume a pedestal a teammate might want) — via `ownsUnmodified`. Shop weapons carry no modifiers, so a second copy is strictly worthless today; once pedestals roll modifiers this guard stops matching and buying two becomes a real choice

then `spendHp` + marks `purchased` (shared → gone for all). Client renders pedestals as `ShopItemEntity` and shows a stats card when P1 stands on one.

**Reward pedestals (shrine boons / boss drops) are a different thing** — free, 1-of-3,
first-come, and they DO pause the room. See [upgrades.md](upgrades.md).

## Acquire flourish

(`entities/AcquireFX.ts`) `LocalPlayer.syncFromServer` diffs the synced weapon list by
per-instance **uid** — not weapon id, since duplicates are legal and an id-based diff
would silently swallow the second pickup. Any newly-present uid fires the Zelda "item
get!" flourish (icon pops above the head + centered `weaponStatLines` panel, showing
the weapon's **rolled** stats) and briefly **freezes that player's input**. The first
sync is absorbed without firing, so joining doesn't flourish the starting weapon.

Acquisition happens in the enemy-free shop or at a cleared reward pedestal, so the
input freeze is safe; revisit if weapons are ever granted mid-combat.

## Preloading

**All weapon icons/FX are preloaded up front** (`GameScene.preload()` loops the whole `WEAPON_REGISTRY`), so any bought/swapped weapon renders without lazy-loading.

## Balance

- **Store** → `GameRoom.ts` (top-of-file consts + `spawnShops()`): `SHOP_ITEM_COUNT` (pedestals per shop, currently 3), the HP `cost` formula (currently `clamp(round(damage × 1.4), 8, 30)`), and `BUY_RADIUS` (40 — must match `SHOP_BUY_RADIUS` in `LocalPlayer.ts`). Items are rolled uniformly from `WEAPON_REGISTRY`.
- **Loadout keybinds / acquire feel** → keys are centralized in `InputSource.ts` (switch/menu/interact per source); the acquire-freeze duration is `ACQUIRE_MS` in `entities/AcquireFX.ts`.
