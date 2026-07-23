import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  TILE_SIZE, ROOM_W, ROOM_H, generateDungeon, roomCellAt, MAP_SEED,
  FloorChangeMessage, BarrierStateMessage,
  WEAPON_REGISTRY, AMMO_REGISTRY, DungeonOptions, DungeonResult, toDungeonOptions,
  RoomType, DebugConfig, DEFAULT_DEBUG_CONFIG,
  GameStateView, PlayerStateView, EnemyStateView, ProjectileStateView,
  ShopStateView, ShopItemStateView, OfferStateView, ChestStateView,
} from "shared";
import { DarknessOverlay } from "../map/DarknessOverlay";
import { BarrierOverlays } from "../map/BarrierOverlays";
import { preloadTiles, buildMap } from "../map/TileRenderer";
import { LocalPlayerManager } from "../input/LocalPlayerManager";
import { LocalPlayer } from "../entities/LocalPlayer";
import { RemotePlayer } from "../entities/RemotePlayer";
import { EnemyEntity } from "../entities/EnemyEntity";
import { ProjectileEntity } from "../entities/ProjectileEntity";
import { CLIENT_CHARACTER_VISUAL_REGISTRY } from "../characters";
import { preloadAttackFX, defineAttackFXAnimations } from "../entities/AttackFXSprites";
import { HitFX, preloadHitFX, defineHitFXAnimation } from "../entities/HitFX";
import { preloadBowSheet, defineBowAnimation } from "../entities/RangedWeaponFX";
import { CLIENT_ENEMY_REGISTRY } from "../enemies";
import { HitboxDebug } from "../debug/HitboxDebug";
import { InventoryHud } from "../ui/InventoryHud";
import { ChallengeBanner } from "../ui/ChallengeBanner";
import { confirmDialog } from "../ui/ConfirmDialog";
import { GameHud } from "../ui/GameHud";
import { Minimap } from "../ui/Minimap";
import { UiLayer } from "../ui/UiLayer";
import { ShopItemEntity } from "../entities/ShopItemEntity";
import { OfferPedestalEntity } from "../entities/OfferPedestalEntity";
import { ChestEntity, preloadChest, defineChestAnimations } from "../entities/ChestEntity";
import { Party } from "../net/Party";
import { PauseMenu } from "../ui/PauseMenu";
import { GameOptions, OPTION_FIELDS, loadOptions, saveOptions } from "../options/gameOptions";
import { showFieldPanel } from "../ui/FieldPanel";
import { showKeybindMenu } from "../ui/KeybindMenu";

/** What LobbyScene hands over: a party that is already in the room, and the
 *  debug knobs the floor was built with (null unless this client hosted a debug
 *  room — joiners read the same knobs off the schema instead). */
export interface GameSceneData {
  party: Party;
  debug: DebugConfig | null;
}


/** Server's `GameState.dungeonOpts`, or null if state hasn't synced yet. */
function parseDungeonOpts(raw: unknown): DungeonOptions | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as DungeonOptions;
  } catch {
    return null;
  }
}

export class GameScene extends Phaser.Scene {
  private localManager!: LocalPlayerManager;
  private remotePlayers = new Map<string, RemotePlayer>();
  private enemies = new Map<string, EnemyEntity>();
  private projectiles = new Map<string, ProjectileEntity>();
  private localSessionIds = new Set<string>();
  private observerRoom: Room | null = null;
  private inventoryHud!: InventoryHud;
  private challengeBanner!: ChallengeBanner;
  private darkness!: DarknessOverlay;
  private roomTypes: Map<string, RoomType> = new Map();
  private shopItems = new Map<string, ShopItemEntity>();
  private offerPedestals = new Map<string, OfferPedestalEntity>();
  private chests = new Map<string, ChestEntity>();
  private hitboxDebug!: HitboxDebug;
  /** The current floor's dungeon. The scene HOLDS the floor rather than treating
   *  generateDungeon as a function to re-call: four call sites regenerated it with
   *  the same seed+opts, which also risked a handler regenerating with a stale
   *  seed field mid-floor-change. rebuildMap is the single writer. */
  private dungeon!: DungeonResult;
  private ui!: UiLayer;
  private hud!: GameHud;
  private minimap!: Minimap;
  /** Rooms the party has stood in this floor — the minimap's "explored" set.
   *  Client-side only, derived from the camera's per-frame room cell. */
  private exploredRooms = new Set<string>();
  /** Connection ids whose advance-blocking parent barrier is still standing.
   *  A room is "cleared" on the minimap once none of its outgoing parent
   *  barriers stand — this mirrors the barrier messages GameScene already gets. */
  private parentStandingConns = new Set<string>();
  /** Connection ids whose retreat-blocking child barrier is standing — i.e. the
   *  party is locked into the child room. Lets a terminal room (no outgoing
   *  barrier of its own) still read as "locked" while it's being fought. */
  private childStandingConns = new Set<string>();
  private ready = false;

  private currentMapGroup: Phaser.GameObjects.Group | null = null;
  private barriers!: BarrierOverlays;
  private hitFx!: HitFX;
  private currentSeed = MAP_SEED;
  private currentFloor = 1;
  private mapCols = 0;
  private mapRows = 0;

  private party!: Party;
  private debug: DebugConfig | null = null;
  // The knobs this floor was generated with — "{}" for a normal game. Must match
  // the server's, or the client renders a different map than the one it's playing.
  private dungeonOpts: DungeonOptions = {};
  private pauseMenu = new PauseMenu();
  // True while a DOM dialog owned by the pause menu (confirm, options) is up, so
  // Escape can't stack a second one behind it.
  private dialogOpen = false;

  constructor() {
    super({ key: "GameScene" });
  }

  // Phaser reuses the scene instance across scene.start(), so every field the
  // previous run mutated has to be reset here rather than at construction.
  /** The camera zoom for this run. Players always get the default 2×; a debug
   *  floor can override it via the Debug menu's Camera zoom knob. */
  private cameraZoom(): number {
    return this.debug?.cameraZoom ?? DEFAULT_DEBUG_CONFIG.cameraZoom;
  }

  init(data: GameSceneData) {
    this.party = data.party;
    this.debug = data.debug;
    this.dungeonOpts = this.debug ? toDungeonOptions(this.debug) : {};
    this.currentSeed = this.debug?.seed || MAP_SEED;
    this.currentFloor = 1;
    this.ready = false;
    this.dialogOpen = false;

    this.remotePlayers.clear();
    this.enemies.clear();
    this.projectiles.clear();
    this.shopItems.clear();
    this.offerPedestals.clear();
    this.chests.clear();
    this.localSessionIds.clear();

    this.currentMapGroup = null;
    this.observerRoom = null;

    this.exploredRooms.clear();
    this.parentStandingConns.clear();
    this.childStandingConns.clear();
  }

  preload() {
    preloadTiles(this);
    preloadAttackFX(this);
    preloadHitFX(this);
    preloadChest(this);

    // Preload each unique character spritesheet once
    const seenTextures = new Set<string>();
    Object.values(CLIENT_CHARACTER_VISUAL_REGISTRY).forEach((def) => {
      if (!seenTextures.has(def.spriteConfig.textureKey)) {
        seenTextures.add(def.spriteConfig.textureKey);
        def.preload(this);
      }
    });

    // Several enemies can share one sheet (the float-skull colours), so preload
    // once per texture key.
    const seenEnemySheets = new Set<string>();
    Object.values(CLIENT_ENEMY_REGISTRY).forEach((def) => {
      if (seenEnemySheets.has(def.textureKey)) return;
      seenEnemySheets.add(def.textureKey);
      def.preload(this);
    });

    // Preload weapon icon PNGs — each weapon's texture key is its id. Held ranged
    // weapons (bows/crossbows) load as a 2-frame draw spritesheet instead.
    for (const weapon of Object.values(WEAPON_REGISTRY)) {
      if (weapon.rangedStyle === "held") {
        preloadBowSheet(this, weapon.id, weapon.iconPath);
      } else {
        this.load.image(weapon.id, weapon.iconPath);
      }
    }

    // Preload projectile (ammo) sprites — texture key is the ammo id.
    for (const ammo of Object.values(AMMO_REGISTRY)) {
      this.load.image(ammo.id, ammo.spritePath);
    }
  }

  async create() {
    defineAttackFXAnimations(this);
    defineHitFXAnimation(this);
    defineChestAnimations(this);

    // Define animations for each unique character spritesheet once
    const seenTextures = new Set<string>();
    Object.values(CLIENT_CHARACTER_VISUAL_REGISTRY).forEach((def) => {
      if (!seenTextures.has(def.spriteConfig.textureKey)) {
        seenTextures.add(def.spriteConfig.textureKey);
        def.defineAnimations(this);
      }
    });

    Object.values(CLIENT_ENEMY_REGISTRY).forEach((def) => def.defineAnimations(this));

    // Define bow/crossbow draw clips (held ranged weapons only).
    for (const weapon of Object.values(WEAPON_REGISTRY)) {
      if (weapon.rangedStyle === "held") defineBowAnimation(this, weapon.id);
    }

    // Keys from the previous run of this scene would otherwise stack up handlers.
    this.input.keyboard!.removeAllKeys(true);

    // Before anything is added to the scene, so the map and every entity built
    // below is picked up as world content by the UI camera's default-ignore hook.
    this.ui = new UiLayer(this, this.scale.width, this.scale.height);

    this.hitFx = new HitFX(this);
    this.barriers = new BarrierOverlays(this);
    // Built before rebuildMap so its first call can lay out the minimap. The
    // toggle is applied once options are loaded, just below.
    this.minimap = new Minimap(this, this.ui);
    this.rebuildMap(this.currentSeed);

    const options = loadOptions();
    this.hitboxDebug = new HitboxDebug(this, options.showHitboxes);
    this.minimap.setVisible(options.showMinimap);

    // No connecting spinner any more: the party has been connected since the
    // lobby, so by the time this scene exists the room is already in hand.
    this.localManager = new LocalPlayerManager(this, this.party);

    const spawn = this.dungeon.playerSpawns[0];
    const locals = this.localManager.buildAll(spawn.x, spawn.y);
    for (const player of locals) this.trackLocalPlayer(player);

    const first = locals[0];
    if (first) {
      this.observerRoom = first.room;
      this.setupWorldSync(first.room);

      // Late-join map sync: the map was built above from our own seed/options, but
      // the server is authoritative — it may have advanced floors, or (joining a
      // room someone else created) be running a different floor shape entirely.
      // Rebuild from the schema once state is in, and again on the first patch in
      // case state wasn't fully synced when join resolved.
      const syncMapFromState = () => {
        const st = first.room.state as any;
        const serverOpts = parseDungeonOpts(st.dungeonOpts);
        const optsChanged =
          serverOpts !== null && JSON.stringify(serverOpts) !== JSON.stringify(this.dungeonOpts);
        const seedChanged = typeof st.seed === "number" && st.seed !== 0 && st.seed !== this.currentSeed;
        if (optsChanged || seedChanged) {
          if (serverOpts !== null) this.dungeonOpts = serverOpts;
          this.rebuildMap(seedChanged ? st.seed : this.currentSeed);
        }
        if (st.floor) this.currentFloor = st.floor;
      };
      syncMapFromState();
      first.room.onStateChange.once(syncMapFromState);

      first.room.onMessage("floor_change", (msg: FloorChangeMessage) => {
        this.handleFloorChange(msg);
      });

      first.room.onMessage("hits", (msg: { impacts: { x: number; y: number }[] }) => {
        for (const p of msg.impacts) this.hitFx.play(p.x, p.y);
      });

      first.room.onMessage("connections_parent_unlocked", (msg: { connectionIds: string[] }) => {
        for (const connId of msg.connectionIds) {
          this.barriers.hideParent(connId);
          this.parentStandingConns.delete(connId);
        }
      });

      first.room.onMessage("connections_child_locked", (msg: { connectionIds: string[] }) => {
        for (const connId of msg.connectionIds) {
          const conn = this.dungeon.connections.find(c => c.id === connId);
          if (conn) this.barriers.showChild(connId, conn.barrierChild);
          this.childStandingConns.add(connId);
        }
      });

      first.room.onMessage("connections_child_unlocked", (msg: { connectionIds: string[] }) => {
        for (const connId of msg.connectionIds) {
          this.barriers.hideChild(connId);
          this.childStandingConns.delete(connId);
        }
      });

      first.room.onMessage("barrier_state", (msg: BarrierStateMessage) => {
        this.applyBarrierState(msg);
      });

      // The map above was built with every parent barrier standing, which is the
      // right guess for a fresh floor and the wrong one for the floor we are
      // actually joining — the pre-clear of empty rooms happened while this
      // client was still in the lobby. Reconcile against the server's picture.
      first.room.send("requestBarrierState");
    }

    // Players are added in the lobby now, not mid-run: the party is fixed when
    // the room locks (D12), which is also what lets difficulty be scaled once at
    // the start rather than chased. The key still answers, so pressing it out of
    // habit explains itself instead of doing nothing.
    this.input.keyboard!.addKey("P").on("down", () => {
      this.hud.flash("Players join from the lobby — this run is locked.");
    });

    // Escape peels one layer at a time (playtest B3), and the bottom of the
    // stack is now a menu rather than the exit:
    //   1. a dialog owned by the pause menu is up — it handles its own Escape
    //   2. an in-world overlay is up (offer picker, then inventory) — close it
    //   3. the pause menu is up — resume
    //   4. bare gameplay — open the pause menu
    this.input.keyboard!.addKey("ESC").on("down", () => {
      if (this.dialogOpen) return;

      for (const player of this.localManager.getAll()) {
        if (player.closeTopOverlay()) return;
      }

      if (this.pauseMenu.isOpen) this.resume();
      else this.openPauseMenu();
    });

    this.inventoryHud = new InventoryHud(this, 56, this.ui);
    this.challengeBanner = new ChallengeBanner(this, 400, 96, this.ui);
    this.darkness = new DarknessOverlay(this);
    this.hud = new GameHud(this, this.ui, options.showControlsHint);

    this.ready = true;
  }

  private rebuildMap(seed: number) {
    if (this.currentMapGroup) {
      this.currentMapGroup.destroy(true);
      this.currentMapGroup = null;
    }
    this.barriers.clear();

    const dungeon = generateDungeon(seed, this.dungeonOpts);
    this.dungeon = dungeon;
    this.mapCols = dungeon.cols;
    this.mapRows = dungeon.rows;
    this.currentSeed = seed;
    // Room types are known locally — the client generates the same dungeon the
    // server did. That's what lets a dark room be a pure client-side visual with
    // no schema field behind it.
    this.roomTypes = dungeon.roomTypes;

    this.currentMapGroup = buildMap(this, dungeon.mapData as any, dungeon.rows, dungeon.cols);
    // Every parent barrier is standing on a fresh map — the guess reconciled
    // against the server via requestBarrierState. The minimap reads this to
    // decide which rooms are cleared.
    this.parentStandingConns = new Set(dungeon.connections.map((c) => c.id));
    this.childStandingConns.clear();
    for (const conn of dungeon.connections) {
      this.barriers.showParent(conn.id, conn.barrierParent);
    }
    this.minimap?.rebuild(dungeon);

    const totalW = dungeon.cols * TILE_SIZE;
    const totalH = dungeon.rows * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.setZoom(this.cameraZoom());
  }

  /** Redraw every barrier overlay from the server's snapshot. Absolute, not a
   *  delta: the point is to be right even when a delta was missed. */
  private applyBarrierState(state: BarrierStateMessage) {
    const parentStanding = new Set(state.parentStanding);
    const childStanding = new Set(state.childStanding);
    this.parentStandingConns = parentStanding;
    this.childStandingConns = childStanding;
    for (const conn of this.dungeon.connections) {
      if (parentStanding.has(conn.id)) this.barriers.showParent(conn.id, conn.barrierParent);
      else this.barriers.hideParent(conn.id);

      if (childStanding.has(conn.id)) this.barriers.showChild(conn.id, conn.barrierChild);
      else this.barriers.hideChild(conn.id);
    }
  }

  private handleFloorChange(msg: FloorChangeMessage) {
    this.currentFloor = msg.floor;
    this.rebuildMap(msg.seed);
    // The new floor's pre-clear broadcast arrived BEFORE this message — i.e.
    // before the map it refers to existed — so ask again rather than trusting it.
    this.observerRoom?.send("requestBarrierState");

    // Don't destroy remote players: the server keeps them in the schema across
    // floors (no onAdd re-fires), so destroying them here would leave their stale
    // onChange closures driving dead objects and no visible sprite. Snap instead.
    this.remotePlayers.forEach((rp) => rp.snapOnNextTarget());
    // Enemies ARE cleared + re-added server-side; onRemove/onAdd recreate them.
    this.enemies.forEach((e) => e.destroy());
    this.enemies.clear();
    // Projectiles are cleared server-side too; drop any stragglers locally.
    this.projectiles.forEach((p) => p.destroy());
    this.projectiles.clear();
  }

  /** Point one local player's view at its own PlayerState, and make sure the
   *  world sync doesn't also draw it as a remote. */
  private trackLocalPlayer(player: LocalPlayer) {
    const sessionId = player.room.sessionId;
    this.localSessionIds.add(sessionId);

    const roomState = player.room.state as GameStateView;
    roomState.players.onAdd((pState: PlayerStateView, sid: string) => {
      if (sid !== sessionId) return;
      const push = () => player.syncFromServer(pState);
      push();
      pState.onChange(push);
    });

    if (this.remotePlayers.has(sessionId)) {
      this.remotePlayers.get(sessionId)!.destroy();
      this.remotePlayers.delete(sessionId);
    }
  }

  // ── Pause menu (playtest D7) ───────────────────────────────────────────────
  // The menu is per-SCREEN, not per-player: one machine, one Escape key. The
  // pause it triggers still travels on P1's connection, so the room freezes for
  // the whole party exactly as the inventory menu already did.

  private openPauseMenu() {
    const first = this.localManager.getAll()[0];
    if (!first) return;
    first.setRoomPaused(true);
    this.pauseMenu.show(
      {
        onResume: () => this.resume(),
        onInventory: () => {
          // Hand off rather than stack: the inventory holds the pause itself, so
          // Escape from there returns to the game, not to this menu.
          this.pauseMenu.hide();
          first.openInventoryMenu();
        },
        onOptions: () => void this.openOptionsFromPause(),
        onAbandon: () => void this.abandonRun(),
      },
      {
        roomCode: this.party.state.roomCode,
        floor: this.currentFloor,
        // Everyone in the ROOM, not just this screen: pausing freezes the whole
        // party, so "solo" here would be a lie to three other people.
        partySize: this.party.state.players.size,
      },
    );
  }

  private resume() {
    this.pauseMenu.hide();
    this.localManager.getAll()[0]?.setRoomPaused(false);
  }

  /** Options, mid-run. Only the settings that can be re-read live are applied
   *  here — the minimap toggle is, the hitbox overlay's starting state isn't.
   *  (Camera zoom is no longer a player option; it's a debug-only knob.) */
  private async openOptionsFromPause() {
    this.dialogOpen = true;
    try {
      let initial = loadOptions();
      for (;;) {
        const result = await showFieldPanel<GameOptions>({
          title: "Options",
          fields: OPTION_FIELDS,
          initial,
          buttons: [
            { id: "keys", label: "Key Bindings" },
            { id: "cancel", label: "Back" },
            { id: "save", label: "Save", primary: true },
          ],
        });
        // Carry in-progress option edits across the round-trip to the rebind
        // screen (it has its own save), then reopen Options where we left off.
        if (result.button === "keys") {
          initial = result.values;
          await showKeybindMenu();
          continue;
        }
        if (result.button === "save") {
          saveOptions(result.values);
          this.minimap.setVisible(result.values.showMinimap);
        }
        break;
      }
    } finally {
      this.dialogOpen = false;
    }
  }

  private async abandonRun() {
    this.dialogOpen = true;
    try {
      const quit = await confirmDialog(
        "ABANDON RUN?",
        "There is no save — this run ends here and the floor is lost.",
        "Abandon run",
      );
      if (!quit) return;
    } finally {
      this.dialogOpen = false;
    }
    this.pauseMenu.hide();
    await this.localManager.leaveAll();
    this.scene.start("MenuScene");
  }

  private setupWorldSync(room: Room) {
    // The one boundary cast in the client. colyseus.js types `room.state` as the
    // untyped decoded state; from here down it is GameStateView, whose interfaces
    // the server's schema classes `implements` — so a renamed @type field is a
    // compile error on the server rather than a silent `undefined` here.
    const state = room.state as GameStateView;

    state.players.onAdd((playerState: PlayerStateView, sessionId: string) => {
      if (this.localSessionIds.has(sessionId)) return;
      const rp = new RemotePlayer(
        this,
        playerState.x,
        playerState.y,
        playerState.characterClass,
        playerState.characterType,
        playerState.weaponId,
      );
      this.remotePlayers.set(sessionId, rp);
      playerState.onChange(() => rp.setTarget(playerState));
    });

    state.players.onRemove((_: PlayerStateView, sessionId: string) => {
      this.remotePlayers.get(sessionId)?.destroy();
      this.remotePlayers.delete(sessionId);
    });

    state.enemies.onAdd((enemyState: EnemyStateView, id: string) => {
      const e = new EnemyEntity(
        this, enemyState.x, enemyState.y, enemyState.enemyType,
        enemyState.maxHealth, enemyState.aggroRadius, enemyState.attackRadius,
      );
      this.enemies.set(id, e);
      enemyState.onChange(() => e.setTarget(enemyState));
    });

    state.enemies.onRemove((_: EnemyStateView, id: string) => {
      this.enemies.get(id)?.destroy();
      this.enemies.delete(id);
    });

    state.projectiles.onAdd((projState: ProjectileStateView, id: string) => {
      const p = new ProjectileEntity(
        this, projState.x, projState.y, projState.angle, projState.ammoId,
      );
      this.projectiles.set(id, p);
      projState.onChange(() => p.setTarget(projState));
    });

    state.projectiles.onRemove((_: ProjectileStateView, id: string) => {
      this.projectiles.get(id)?.destroy();
      this.projectiles.delete(id);
    });

    // Shop pedestals: one ShopItemEntity per shop item, keyed "roomId:index".
    // Items only change via `purchased` (shared pool); floor change clears the
    // whole shops map, firing onRemove for the old rooms.
    state.shops.onAdd((shop: ShopStateView, roomId: string) => {
      shop.items.forEach((item: ShopItemStateView, idx: number) => {
        const key = `${roomId}:${idx}`;
        const view = new ShopItemEntity(this, item.x, item.y, item.weaponId, item.cost);
        view.setPurchased(item.purchased);
        this.shopItems.set(key, view);
        item.onChange(() => view.setPurchased(item.purchased));
      });
    });

    state.shops.onRemove((_: ShopStateView, roomId: string) => {
      for (const [key, view] of this.shopItems) {
        if (key.startsWith(`${roomId}:`)) {
          view.destroy();
          this.shopItems.delete(key);
        }
      }
    });

    // Reward pedestals: one per shrine room, plus one dropped where a boss died.
    // Keyed by room id — a boss drop appears mid-floor, so this map grows during
    // play rather than only at floor start.
    state.offers.onAdd((offer: OfferStateView, roomId: string) => {
      const view = new OfferPedestalEntity(this, offer.x, offer.y);
      this.offerPedestals.set(roomId, view);
      // The pedestal is shared: it ghosts only once every card has been drafted, not
      // when a single player picks (the rest of the party may still have picks).
      const refresh = () => view.setClaimed(offer.consumed.length >= offer.choices.length);
      // A push to the consumed list is what marks a card taken; listen to the list,
      // since a child-collection mutation doesn't fire the parent schema's onChange.
      (offer.consumed as unknown as { onAdd(cb: () => void): void }).onAdd(refresh);
      refresh();
    });

    state.offers.onRemove((_: OfferStateView, roomId: string) => {
      this.offerPedestals.get(roomId)?.destroy();
      this.offerPedestals.delete(roomId);
    });

    // Treasure chests: one per chest room, keyed by room id. `opened` is the only
    // field that ever changes; floor change clears the whole map, firing onRemove.
    state.chests.onAdd((chest: ChestStateView, roomId: string) => {
      const view = new ChestEntity(this, chest.x, chest.y, chest.gold, chest.opened);
      this.chests.set(roomId, view);
      chest.onChange(() => view.setOpened(chest.opened));
    });

    state.chests.onRemove((_: ChestStateView, roomId: string) => {
      this.chests.get(roomId)?.destroy();
      this.chests.delete(roomId);
    });
  }

  /** Which rooms the minimap should paint as cleared. A room is cleared once
   *  nothing gates it any more: no outgoing advance-barrier of its own still
   *  stands, and no retreat-barrier locks the party into it. Derived from the
   *  same barrier bookkeeping the overlays use — no extra server signal. */
  private clearedRooms(): Set<string> {
    const cleared = new Set<string>();
    for (const room of this.dungeon.rooms) {
      const gatedOut = this.dungeon.connections.some(
        (c) => c.parentRoomId === room.id && this.parentStandingConns.has(c.id),
      );
      const lockedIn = this.dungeon.connections.some(
        (c) => c.childRoomId === room.id && this.childStandingConns.has(c.id),
      );
      if (!gatedOut && !lockedIn) cleared.add(room.id);
    }
    return cleared;
  }

  update() {
    if (!this.ready) return;
    this.localManager.update();
    this.remotePlayers.forEach((rp) => rp.update());
    this.enemies.forEach((e) => e.update());
    this.projectiles.forEach((p) => p.update());
    this.hitboxDebug.update([
      ...this.localManager.getAll(),
      ...this.remotePlayers.values(),
      ...this.enemies.values(),
      ...this.projectiles.values(),
    ]);

    const { x, y } = this.localManager.getCentroid();

    const cell = roomCellAt(x, y);
    const bx = cell.gx * ROOM_W * TILE_SIZE;
    const by = cell.gy * ROOM_H * TILE_SIZE;
    this.cameras.main.setBounds(bx, by, ROOM_W * TILE_SIZE, ROOM_H * TILE_SIZE);
    this.cameras.main.centerOn(x, y);

    // Inventory HUD tracks the first local player; PAUSED overlay follows the
    // server's shared pause flag.
    const first = this.localManager.getAll()[0];
    const firstState = first?.room.state.players.get(first.room.sessionId);
    if (firstState) {
      this.inventoryHud.update(Array.from(firstState.weapons), firstState.activeWeaponIndex);
    }
    // Room ids are "gx,gy" and the camera lock above already resolved the party's
    // room cell, so both the banner and the darkness reuse those numbers rather
    // than recomputing room membership.
    const roomId = cell.id;
    // The objective banner, read straight off the MapSchema — a challenge has no
    // world view to manage, so it needs no onAdd/onRemove bookkeeping the way
    // pedestals do.
    this.challengeBanner.update(this.observerRoom?.state.challenges?.get(roomId));
    // Darkness is decided entirely from the locally generated room type.
    this.darkness.update(this.roomTypes.get(roomId) === "dark", x, y, bx, by);
    const obs = this.observerRoom?.state;

    // Minimap: the party's current cell is explored the moment the camera enters
    // it. Cleared rooms are derived from the barrier state GameScene tracks.
    this.exploredRooms.add(roomId);
    this.minimap.update({
      currentRoomId: roomId,
      explored: this.exploredRooms,
      cleared: this.clearedRooms(),
    });
    this.minimap.updateMarker(x, y);
    this.hud.update({
      players: this.localManager.getAll(),
      floor: this.currentFloor,
      debug: this.debug != null,
      paused: obs?.paused ?? false,
      playersOnStairs: obs?.playersOnStairs ?? 0,
      stairsPartySize: obs?.stairsPartySize ?? 0,
    });
  }

}
