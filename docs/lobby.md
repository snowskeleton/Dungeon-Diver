# Menus, lobbies and matchmaking

How a player gets from the title screen into a run, alone or with strangers.
Built from the first playtest's decisions **D7** (a pause menu you can resume
from), **D8** (solo or shared at game start) and **D12** (rooms are public-listed
or private-by-code; **lobby-only joins**).

## The one idea

**A room's lobby and its run are the same Colyseus room, in two phases.**

`GameState.phase` is `"lobby"` until the host starts, then `"run"`, and never
goes back. The alternative — a separate lobby room that hands you off to a game
room — would make every client tear down one connection and open another at
exactly the moment the run begins, with a party to keep in sync across the gap.
Here there is no handover at all: the client stops drawing a panel and starts
drawing a dungeon.

Three things fall out of that for free:

- **Lobby-only joins are one `room.lock()`.** A locked Colyseus room is absent
  from the room list *and* rejects `joinById`, so there is no second door to keep
  consistent. The room is never unlocked — a run that wants more players is a new
  room.
- **Nothing ticks in a lobby.** `GameRoom.tick` returns immediately unless the
  phase is `"run"`. The floor is generated at `onCreate` (so the seed is settled
  and joiners agree on the map) but nothing lives on it: enemies spawn in
  `startRun()`, not on first join.
- **Couch co-op and online co-op are the same thing.** Players 2–4 on one machine
  are ordinary connections to the same room, added from the lobby. They arrive
  flagged `couch: true` and are marked ready on arrival, because making the host
  tick a ready box for the person next to them is ceremony with no information.

## The flow

```
MenuScene ──Play Solo───────────────► (host a private room) ──► LobbyScene ──► GameScene
    │                                                              ▲              ▲
    ├──Play Online──► BrowseScene ──join / code / host─────────────┘              │
    │                                                                             │
    └──Debug──► field panel ──► (host a private room, debug opts) ──► LobbyScene ─┘
```

Solo is not a separate code path — it is a **private room nobody can find**. That
is what keeps couch co-op alive in the solo flow, and what lets a solo player
open their next run to a friend without any of this changing.

## Where things live

| File | What it is |
|---|---|
| `shared/src/lobby.ts` | `RunPhase`, join/create options, `RoomMetadata`, the lobby message payloads, the room-code alphabet |
| `server/src/rooms/GameRoom.ts` | The phase itself: lobby message handlers, `startRun()`, host migration |
| `server/src/rooms/roomCodes.ts` | Allocating a unique code, and resolving one back to a room id |
| `server/src/index.ts` | `GET /api/rooms/by-code/:code` — the only way to reach a private room |
| `client/src/net/Party.ts` | The 1–4 connections this machine holds to one room, plus `listRooms()` |
| `client/src/net/serverUrl.ts` | The ws endpoint and its matching http origin, resolved together |
| `client/src/scenes/BrowseScene.ts` | Room list, join-by-code, host-a-room |
| `client/src/scenes/LobbyScene.ts` | Roster, loadout changes, ready, start |
| `client/src/ui/LobbyPanel.ts`, `ui/RoomBrowserPanel.ts` | Their DOM views |
| `client/src/ui/PauseMenu.ts` | D7's resumable pause menu |
| `client/src/ui/menuDom.ts` | The shared stylesheet + builders for the menu DOM — every overlay in the game now, not just these three (see below) |
| `client/src/options/profile.ts` | Name + last-used loadout, remembered between sessions |

## Room codes

Four characters from a 32-symbol alphabet with no `O/0/I/1` — a code gets read
aloud or typed off a screenshot, and those are the pairs people get wrong.

The code lives in the room's **metadata**, not its state, because that is what a
lookup can see without joining: `matchMaker.query` returns listings, and a
private room's listing is the only trace of it a stranger can reach. Codes are
allocated by scanning live listings and retrying on collision — the space is ~1M,
but a collision would silently send a player into a stranger's run, which is the
one failure a join code must not have.

`findRoomByCode` distinguishes **missing**, **started** and **full**, because
they are three different things for a player to do next. Started and full are
told apart by metadata rather than by `locked`, since Colyseus locks a room for
both reasons.

## Party, and why LocalPlayerManager was split

`Party` (client) owns the sockets; `LocalPlayerManager` owns the sprites.

They used to be one class that both dialled the server and built Phaser objects,
which worked while the only way into a game was `GameScene` calling
`joinOrCreate` on load. A lobby breaks that: the connections are made minutes
earlier, in a scene with no world in it, and must survive the scene change. So
the lobby builds a `Party` and hands it to `GameScene`, which renders the members
it finds and joins nothing.

`Party.members[0]` is the world observer — the same "first local player's room
sees everything" rule as before.

## One stylesheet, six panels later

`menuDom.ts` arrived with the lobby and at first dressed only its own three
screens, while six older overlays — the character and weapon pickers, the
inventory, the offer picker, the confirm dialog, `FieldPanel` — each carried a
near-identical private copy of the same overlay/modal/button CSS. They are all on
it now.

The rule that keeps it that way: **a panel's own file styles only what makes that
panel different.** Three things genuinely did — the character portraits are one
frame cropped out of a walk sheet, the weapon picker pages its content with tabs,
and the confirm dialog is red because it is the one overlay that asks you to
destroy something. Everything else (overlay, panel, row, tile, card, chip, badge,
input, button) is a class in `menuDom`, injected once through `addStyle`.

Two things to know if you add a panel:

- **`.m-tile.bare` is declared before the hover/selected rules on purpose.**
  Equal-specificity CSS resolves by source order, so a `bare` tile written after
  `.m-tile.selected` silently eats its highlight — which it did, and the weapon
  picker showed no selection at all until the order was fixed.
- **Escape is not always the panel's to handle.** `menuPanel({ onEscape })` grabs
  the key on the window in capture, so a panel that opts in takes it away from
  whoever else wants it. The inventory and offer pickers deliberately pass no
  handler: over the world, Escape belongs to `GameScene`, which peels overlays in
  a defined order and unpauses through the player's own connection.

## Gotchas worth knowing

- **A client that starts a run from the lobby misses every barrier broadcast.**
  `startRun()` populates the floor and pre-clears its empty rooms while every
  client is still looking at a lobby panel, so the incremental
  `connections_parent_unlocked` message lands with nobody listening. `GameScene`
  therefore asks for a **snapshot** (`requestBarrierState` → `barrier_state`)
  once its map is built, and again after every floor change — where the same
  ordering bug already existed, since the pre-clear broadcast precedes
  `floor_change` and so describes a map the client hasn't built yet. Deltas are
  fine for changes *during* play; the snapshot is what makes the starting picture
  right.
- **Changing class in the lobby rebuilds the `Player`.** Stats fold off
  `charConfig`, which is set at construction — so `setLoadout` constructs a new
  Player and swaps it into the map. That is only safe because no client is
  rendering the world yet.
- **Phaser's keyboard listens on the window.** The lobby's name field is a DOM
  input over the canvas, so the `P` (add couch player) binding has to ignore key
  presses while an input has focus, or typing a name would open a picker.
- **A click can activate the previously selected menu item.** Phaser resolves
  pointer-over in its update loop, which can run *after* the down event of the
  same click, so `MenuScene` selects on `pointerdown` as well as on hover.

## Verifying

`tests/server/game-room.test.ts` drives the rules above against a REAL `GameRoom`
with Colyseus's transport stubbed — no running server needed:

```bash
npx vitest run tests/server/game-room.test.ts
```

It covers: a fresh room opens in `lobby` with nothing spawned · a public lobby is
listed with its host · a guest joins unready · start is refused and names who
we're waiting on · starting spawns enemies and locks the room · a started run is
unlisted, unjoinable by id, and reports itself as started to a code lookup ·
lobby messages are refused mid-run · a private room is unlisted but resolves from
its code · the barrier snapshot reports pre-cleared rooms as unlocked.

## Still open

- **Pause is still room-wide** — any player's pause menu or inventory freezes
  everyone. That was fine when a party was four friends on a couch; with
  strangers it is a griefing surface. Left as-is deliberately (it is the existing
  design, and changing it changes solo feel too), but it wants a decision.
- **No reconnect.** Dropping means losing the run; Colyseus's
  `allowReconnection` would fit the locked-room model well.
- **Party size does not gate difficulty yet** — D13's start-fixed HP scaling has
  the hook it needs now (the roster is settled before anything spawns) but is not
  built.
