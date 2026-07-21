import Phaser from "phaser";
import { Client } from "colyseus.js";
import { CharacterClass, CharacterType, DebugConfig, WeaponId } from "shared";
import { LocalPlayer } from "../entities/LocalPlayer";
import { KeyboardInputSource, GamepadInputSource } from "./InputSource";

// Where the client dials the Colyseus server.
//   1. VITE_SERVER_URL, if set, wins outright (a full ws:// or wss:// endpoint).
//   2. Served over HTTPS (production): the server process serves this very page AND
//      Colyseus on one origin, so connect same-origin — `wss://<host>`. A reverse
//      proxy in front just forwards everything; no port, path, or CORS story.
//   3. Plain HTTP (local dev): talk straight to the Colyseus port. Override the
//      port with VITE_SERVER_PORT to run an isolated instance without a clash.
function resolveServerUrl(): string {
  const explicit = import.meta.env.VITE_SERVER_URL;
  if (explicit) return explicit;
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}`;
  }
  const port = import.meta.env.VITE_SERVER_PORT ?? "2567";
  return `ws://${window.location.hostname}:${port}`;
}
const SERVER_URL = resolveServerUrl();
const MAX_LOCAL = 4;

export class LocalPlayerManager {
  private scene: Phaser.Scene;
  private localPlayers: LocalPlayer[] = [];
  private pendingJoins = 0;
  // Room the first local player landed in; players 2–4 join it by id so a debug
  // room (which is never matchmade into) still gets the whole couch.
  private roomId: string | null = null;
  // Passed to the server on room creation; only the creating client's copy is read.
  private debug: DebugConfig | null = null;

  constructor(scene: Phaser.Scene, debug: DebugConfig | null = null) {
    this.scene = scene;
    this.debug = debug;
  }

  async addPlayer(
    x: number,
    y: number,
    characterClass: CharacterClass = "knight",
    characterType: CharacterType = "guy",
    weaponId?: WeaponId,
  ): Promise<LocalPlayer | null> {
    const index = this.localPlayers.length + this.pendingJoins;
    if (index >= MAX_LOCAL) return null;

    this.pendingJoins++;
    let room;
    try {
      const client = new Client(SERVER_URL);
      const opts = { characterClass, characterType, weaponId, debug: this.debug };
      if (this.roomId) {
        room = await client.joinById(this.roomId, opts);
      } else if (this.debug) {
        // Debug floors must never reuse a room built with different options.
        room = await client.create("game", opts);
      } else {
        room = await client.joinOrCreate("game", opts);
      }
      this.roomId = room.roomId;
    } finally {
      this.pendingJoins--;
    }

    let inputSource;
    if (index === 0) {
      inputSource = new KeyboardInputSource(this.scene.input.keyboard!, "wasd");
    } else if (index === 1) {
      inputSource = new KeyboardInputSource(this.scene.input.keyboard!, "arrows");
    } else {
      inputSource = new GamepadInputSource(this.scene, index - 2);
    }

    const player = new LocalPlayer(this.scene, x, y, room, inputSource, characterClass, characterType, weaponId);
    this.localPlayers.push(player);
    return player;
  }

  update() {
    this.localPlayers.forEach((p) => p.update());
  }

  getAll(): LocalPlayer[] {
    return this.localPlayers;
  }

  getCentroid(): { x: number; y: number } {
    if (this.localPlayers.length === 0) return { x: 400, y: 288 };
    const sum = this.localPlayers.reduce(
      (acc, p) => ({ x: acc.x + p.sprite.x, y: acc.y + p.sprite.y }),
      { x: 0, y: 0 },
    );
    return { x: sum.x / this.localPlayers.length, y: sum.y / this.localPlayers.length };
  }

  async leaveAll() {
    await Promise.all(this.localPlayers.map((p) => p.room.leave()));
    this.localPlayers.forEach((p) => p.destroy());
    this.localPlayers = [];
    this.roomId = null;
  }
}
