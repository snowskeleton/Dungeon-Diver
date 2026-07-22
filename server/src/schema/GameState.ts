import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";
import { EnemyState } from "./EnemyState";
import { ProjectileState } from "./ProjectileState";
import { ShopState } from "./ShopState";
import { OfferState } from "./OfferState";
import { ChestState } from "./ChestState";
import { RoomChallengeState } from "./RoomChallengeState";
import { GameStateView, RunPhase } from "shared";

export class GameState extends Schema implements GameStateView {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: EnemyState }) enemies = new MapSchema<EnemyState>();
  @type({ map: ProjectileState }) projectiles = new MapSchema<ProjectileState>();
  // Shop contents keyed by room id — populated per floor for each shop room.
  @type({ map: ShopState }) shops = new MapSchema<ShopState>();
  // Reward pedestals keyed by room id — one per shrine room, plus one dropped in
  // the boss room when the boss dies.
  @type({ map: OfferState }) offers = new MapSchema<OfferState>();
  // Treasure chests keyed by room id — one per chest room, rebuilt per floor.
  @type({ map: ChestState }) chests = new MapSchema<ChestState>();
  // Active room objectives keyed by room id — one per room whose type carries a
  // RoomChallenge, rebuilt per floor.
  @type({ map: RoomChallengeState }) challenges = new MapSchema<RoomChallengeState>();
  @type("uint8") floor: number = 1;
  // Current dungeon seed — synced so late joiners can build the right map
  // (the floor_change broadcast only reaches clients already connected).
  @type("uint32") seed: number = 0;
  // JSON-serialized DungeonOptions for the current floor. Clients generate their
  // map locally, so they need the same knobs the server generated with ("{}" for
  // a normal floor). Synced rather than passed at join so late joiners agree too.
  @type("string") dungeonOpts: string = "{}";
  // True while any player has the inventory/stats menu open — the tick freezes
  // all simulation while set (the store does NOT use this).
  @type("boolean") paused: boolean = false;
  // ── Lobby ────────────────────────────────────────────────────────────────
  // A room gathers a party before it simulates anything. Everything below is
  // read by the lobby panel; `phase` is also the client's signal to start
  // GameScene, and it only ever moves lobby → run.
  @type("string") phase: RunPhase = "lobby";
  @type("string") hostSessionId: string = "";
  @type("string") roomName: string = "";
  @type("string") roomCode: string = "";
  @type("boolean") isPrivate: boolean = false;
}
