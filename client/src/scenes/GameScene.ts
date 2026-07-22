import Phaser from "phaser";
import { Room } from "colyseus.js";
import {
  TILE_SIZE, ROOM_W, ROOM_H, generateDungeon, roomCellAt, MAP_SEED, FloorChangeMessage,
  WEAPON_REGISTRY, AMMO_REGISTRY, DungeonOptions, DungeonResult, toDungeonOptions,
  RoomType,
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
import { UiLayer } from "../ui/UiLayer";
import { ShopItemEntity } from "../entities/ShopItemEntity";
import { OfferPedestalEntity } from "../entities/OfferPedestalEntity";
import { ChestEntity, preloadChest, defineChestAnimations } from "../entities/ChestEntity";
import { LaunchConfig, Loadout, defaultLoadout, pickLoadout } from "../launch";
import { loadOptions } from "../options/gameOptions";


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
  private ready = false;

  private currentMapGroup: Phaser.GameObjects.Group | null = null;
  private barriers!: BarrierOverlays;
  private hitFx!: HitFX;
  private currentSeed = MAP_SEED;
  private currentFloor = 1;
  private mapCols = 0;
  private mapRows = 0;

  private launch!: LaunchConfig;
  // The knobs this floor was generated with — "{}" for a normal game. Must match
  // the server's, or the client renders a different map than the one it's playing.
  private dungeonOpts: DungeonOptions = {};
  // True while a DOM character/weapon picker is up (see the Escape handler).
  private pickerOpen = false;
  // True while the abandon-run confirm is up, so Escape can't stack dialogs.
  private quitPending = false;

  constructor() {
    super({ key: "GameScene" });
  }

  // Phaser reuses the scene instance across scene.start(), so every field the
  // previous run mutated has to be reset here rather than at construction.
  init(config?: LaunchConfig) {
    this.launch = config ?? { debug: null, loadout: defaultLoadout() };
    this.dungeonOpts = this.launch.debug ? toDungeonOptions(this.launch.debug) : {};
    this.currentSeed = this.launch.debug?.seed || MAP_SEED;
    this.currentFloor = 1;
    this.ready = false;

    this.remotePlayers.clear();
    this.enemies.clear();
    this.projectiles.clear();
    this.shopItems.clear();
    this.offerPedestals.clear();
    this.chests.clear();
    this.localSessionIds.clear();

    this.currentMapGroup = null;
    this.observerRoom = null;
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
    this.rebuildMap(this.currentSeed);

    const options = loadOptions();
    this.hitboxDebug = new HitboxDebug(this, options.showHitboxes);

    const connecting = this.ui.add(
      this.add
        .text(400, 288, "Connecting to server…", {
          fontSize: "18px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setDepth(20),
    );

    this.localManager = new LocalPlayerManager(this, this.launch.debug);

    const spawn = this.dungeon.playerSpawns[0];

    const first = await this.joinLocal(spawn.x, spawn.y, this.launch.loadout);
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
        for (const connId of msg.connectionIds) this.barriers.hideParent(connId);
      });

      first.room.onMessage("connections_child_locked", (msg: { connectionIds: string[] }) => {
        for (const connId of msg.connectionIds) {
          const conn = this.dungeon.connections.find(c => c.id === connId);
          if (conn) this.barriers.showChild(connId, conn.barrierChild);
        }
      });

      first.room.onMessage("connections_child_unlocked", (msg: { connectionIds: string[] }) => {
        for (const connId of msg.connectionIds) this.barriers.hideChild(connId);
      });
    }

    this.input.keyboard!.addKey("P").on("down", async () => {
      const sp = this.dungeon.playerSpawns[0];
      await this.joinLocal(sp.x, sp.y);
    });

    // Escape peels off one layer at a time (playtest B3). Previously it always
    // quit to the menu, so the pause menu could be opened but never closed, and a
    // reflexive Escape threw away a run in progress.
    //   1. a join picker is up — it handles its own Escape (Phaser still sees the
    //      keypress through the DOM overlay, so we must not act on it here)
    //   2. an overlay is up (offer picker, then pause menu) — close the topmost
    //   3. bare gameplay — confirm, because abandoning a run can't be undone
    this.input.keyboard!.addKey("ESC").on("down", async () => {
      if (this.pickerOpen) return;
      if (this.quitPending) return;

      for (const player of this.localManager.getAll()) {
        if (player.closeTopOverlay()) return;
      }

      this.quitPending = true;
      try {
        const quit = await confirmDialog(
          "ABANDON RUN?",
          "There is no save — this run ends here and the floor is lost.",
          "Abandon run",
        );
        if (!quit) return;
      } finally {
        this.quitPending = false;
      }
      await this.localManager.leaveAll();
      this.scene.start("MenuScene");
    });

    this.inventoryHud = new InventoryHud(this, 56, this.ui);
    this.challengeBanner = new ChallengeBanner(this, 400, 96, this.ui);
    this.darkness = new DarknessOverlay(this);
    this.hud = new GameHud(this, this.ui, options.showControlsHint);

    connecting.destroy();
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
    for (const conn of dungeon.connections) {
      this.barriers.showParent(conn.id, conn.barrierParent);
    }

    const totalW = dungeon.cols * TILE_SIZE;
    const totalH = dungeon.rows * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.setZoom(loadOptions().cameraZoom);
  }

  private handleFloorChange(msg: FloorChangeMessage) {
    this.currentFloor = msg.floor;
    this.rebuildMap(msg.seed);

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

  /**
   * Join one local player. P1 arrives with the loadout already chosen in the menu;
   * P2–P4 (the `P` key) pick theirs here.
   */
  private async joinLocal(x: number, y: number, preset?: Loadout): Promise<LocalPlayer | null> {
    let loadout = preset;
    if (!loadout) {
      const slot = this.localManager.getAll().length + 1;
      this.pickerOpen = true;
      try {
        loadout = (await pickLoadout(`Player ${slot}`)) ?? undefined;
      } finally {
        this.pickerOpen = false;
      }
      if (!loadout) return null; // player cancelled
    }

    const player = await this.localManager.addPlayer(
      x, y, loadout.characterClass, loadout.characterType, loadout.weaponId,
    );
    if (!player) return null;

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

    return player;
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
      view.setClaimed(offer.claimed);
      this.offerPedestals.set(roomId, view);
      offer.onChange(() => view.setClaimed(offer.claimed));
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
    this.hud.update({
      players: this.localManager.getAll(),
      floor: this.currentFloor,
      debug: this.launch.debug != null,
      paused: this.observerRoom?.state.paused ?? false,
    });
  }

}
