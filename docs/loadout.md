# Inventory, weapon switching, store & pause

Read this before touching the inventory, shops, pause, or the acquire flourish.

Players own **multiple** weapons and swap between them; new ones are bought in shops, claimed from reward pedestals, or (their first) taken from the floor-1 supply room. All of it is **server-authoritative** (the active weapon drives server hitboxes/damage/cooldown, and gold-cost purchases can't be client-trusted) and synced to clients.

**Players spawn empty-handed** — there is no default/starting weapon. The first weapon is claimed at the floor-1 **supply room** (`LootDirector.spawnSupply`), which drops one pedestal per player rolled from that class's unique first-weapon categories. See the class-restriction section below.

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

Buying spends **gold from the shared party purse** (`GameState.gold`, fed by enemy coin drops — see the Currency system in `shared/src/economy.ts`). Shop prices are **fixed tiers** (`SHOP_TIERS`, 50/100/150), not a per-weapon formula; depth scales the shop's *quality*, not its cost. `LootDirector`'s `buy` handler (relayed one-line by `GameRoom`) validates:
1. proximity (`BUY_RADIUS`)
2. unsold
3. **class can equip it** (`Player.canEquip`, D9/D18) — else a `loot_error`, no charge
4. purse covers `cost`
5. **that the buyer doesn't already own an unmodified copy** (else it'd waste gold and consume a pedestal a teammate might want) — via `ownsUnmodified`. Shop weapons carry no modifiers, so a second copy is strictly worthless today; once pedestals roll modifiers this guard stops matching and buying two becomes a real choice

then deducts gold + marks `purchased` (shared → gone for all). Client renders pedestals as `ShopItemEntity` and shows a stats card when P1 stands on one.

**Reward pedestals (shrine boons / boss drops) are a different thing** — free, 1-of-3,
first-come, and they DO pause the room. See [upgrades.md](upgrades.md).

## Acquire flourish

(`entities/AcquireFX.ts`) `LocalPlayer.syncFromServer` diffs the synced weapon list by
per-instance **uid** — not weapon id, since duplicates are legal and an id-based diff
would silently swallow the second pickup. Any newly-present uid fires the Zelda "item
get!" flourish (icon pops above the head + centered `weaponStatLines` panel, showing
the weapon's **rolled** stats) and briefly **freezes that player's input**. The first
sync is absorbed without firing, so a player who joins already holding weapons (a
mid-run rejoin) doesn't re-flourish them.

Acquisition happens in the enemy-free shop, the supply room, or at a cleared reward
pedestal, so the input freeze is safe; revisit if weapons are ever granted mid-combat.

## Preloading

**All weapon icons/FX are preloaded up front** (`GameScene.preload()` loops the whole `WEAPON_REGISTRY`), so any bought/swapped weapon renders without lazy-loading.

## Balance

- **Store** → `LootDirector.ts` (top-of-file consts + `spawnShops()`): `SHOP_ITEM_COUNT` (pedestals per shop, currently 3), the fixed `SHOP_TIERS` gold prices, and `BUY_RADIUS` (40 — must match `SHOP_BUY_RADIUS` in `LocalPlayer.ts`). Items are rolled from `partyRollableWeaponIds(partyClasses)` — the **class-filtered** pool (D10), so a weapon nobody present can equip never appears; never the whole `WEAPON_REGISTRY`.
- **Loadout keybinds / acquire feel** → keys are centralized in `InputSource.ts` (switch/menu/interact per source); the acquire-freeze duration is `ACQUIRE_MS` in `entities/AcquireFX.ts`.

## Class restriction (D9/D18) & the supply room

Weapons are gated by **class**, and the restriction is declared on the class itself —
each `Character`'s `usableCategories` getter (`shared/src/characters/<Class>.ts`, OO,
no lookup table). The three melee categories (sword/axe/spear) are the shared
backbone every class gets; each class also owns one **unique** category that is
its identity and its first-weapon pool (Knight → mace, Rogue → thrown,
Ranger → bow, Mage → staff).

- `Player.canEquip(weaponId)` gates **every** weapon-granting path — shop, offer,
  room-clear reward, supply pedestal, maze chest. An incompatible pickup grants
  nothing and returns `WRONG_CLASS_MSG`, which `GameRoom` relays as `loot_error`
  (the client flashes it). Loot rolls are pre-filtered to the present party
  (`partyRollableWeaponIds`, D10) so refusals are rare in practice.
- The **supply room** is the floor-1 start room. `LootDirector.spawnSupply` lays one
  pedestal per player, rolled from `firstRollWeaponIds(class)` (that class's unique
  categories). The Debug menu's **First weapon** picker can force which weapon drops
  here (`DebugConfig.firstWeaponId`) — honoured only when the player's class can equip
  it, otherwise it falls back to the random roll.
