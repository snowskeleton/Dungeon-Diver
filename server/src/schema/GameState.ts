import { Observable, ObservableMap, ObservableList, tracked } from "shared";
import { PlayerState } from "./PlayerState";
import { EnemyState } from "./EnemyState";
import { ProjectileState } from "./ProjectileState";
import { ShopState } from "./ShopState";
import { OfferState } from "./OfferState";
import { RewardState } from "./RewardState";
import { ChestState } from "./ChestState";
import { DroppedWeaponState } from "./DroppedWeaponState";
import { CoinState } from "./CoinState";
import { RoomChallengeState } from "./RoomChallengeState";
import { GameStateView, RunPhase } from "shared";

export class GameState extends Observable implements GameStateView {
  @tracked({ map: PlayerState }) players = new ObservableMap<PlayerState>();
  @tracked({ map: EnemyState }) enemies = new ObservableMap<EnemyState>();
  @tracked({ map: ProjectileState }) projectiles = new ObservableMap<ProjectileState>();
  // Shop contents keyed by room id — populated per floor for each shop room.
  @tracked({ map: ShopState }) shops = new ObservableMap<ShopState>();
  // Reward pedestals keyed by room id — one per shrine room, plus one dropped in
  // the boss room when the boss dies.
  @tracked({ map: OfferState }) offers = new ObservableMap<OfferState>();
  // Single-reward pedestals keyed by room id — one dropped where each non-reward
  // room's last enemy fell, rebuilt per floor.
  @tracked({ map: RewardState }) rewards = new ObservableMap<RewardState>();
  // Floor-1 supply-room weapon pedestals, keyed by a per-pedestal id (one per
  // player). Reuses RewardState (kind "weapon") — a supply pedestal IS a single
  // free weost reward; the only difference is several per room. Class-gated on
  // free weapon reward; the only difference is several per room. Class-gated on
  // claim like every weapon pickup, not owner-locked.
  @tracked({ map: RewardState }) supplies = new ObservableMap<RewardState>();
  // Treasure chests keyed by room id — one at the deep end of every maze room,
  // placed at floor generation and openable anytime, rebuilt per floor.
  @tracked({ map: ChestState }) chests = new ObservableMap<ChestState>();
  // Weapons set down on the floor, keyed by a per-drop id. Created when a player at
  // the weapon cap takes a new weapon (their held one drops here); removed when
  // someone picks it back up. Rebuilt per floor.
  @tracked({ map: DroppedWeaponState }) droppedWeapons = new ObservableMap<DroppedWeaponState>();
  // Active room objectives keyed by room id — one per room whose type carries a
  // RoomChallenge, rebuilt per floor.
  @tracked({ map: RoomChallengeState }) challenges = new ObservableMap<RoomChallengeState>();
  // Loose coins on the floor, keyed by coin id — dropped on enemy death, removed
  // when swept up into the shared purse.
  @tracked({ map: CoinState }) coins = new ObservableMap<CoinState>();
  // The shared party purse: one communal pool of gold (roadmap "Currency").
  // Rewards are personal, money is communal — a contested resource makes players
  // negotiate, which is better co-op than four isolated wallets.
  @tracked("uint32") gold: number = 0;
  @tracked("uint8") floor: number = 1;
  // Current dungeon seed — synced so late joiners can build the right map
  // (the floor_change broadcast only reaches clients already connected).
  @tracked("uint32") seed: number = 0;
  // JSON-serialized DungeonOptions for the current floor. Clients generate their
  // map locally, so they need the same knobs the server generated with ("{}" for
  // a normal floor). Synced rather than passed at join so late joiners agree too.
  @tracked("string") dungeonOpts: string = "{}";
  // True while any player has the inventory/stats menu open — the tick freezes
  // all simulation while set (the store does NOT use this).
  @tracked("boolean") paused: boolean = false;
  // Party-stairs prompt (playtest D5): the floor only descends once every living
  // player stands on the stairs together. Recomputed each tick — `playersOnStairs`
  // of `stairsPartySize` are on it right now — so the client can render a
  // "N/M on stairs" prompt. Solo is stairsPartySize 1, so it descends at once.
  @tracked("uint8") playersOnStairs: number = 0;
  @tracked("uint8") stairsPartySize: number = 0;
  // ── Lobby ────────────────────────────────────────────────────────────────
  // A room gathers a party before it simulates anything. Everything below is
  // read by the lobby panel; `phase` is also the client's signal to start
  // GameScene, and it only ever moves lobby → run.
  @tracked("string") phase: RunPhase = "lobby";
  @tracked("string") hostSessionId: string = "";
  @tracked("string") roomName: string = "";
  @tracked("string") roomCode: string = "";
  @tracked("boolean") isPrivate: boolean = false;
}
