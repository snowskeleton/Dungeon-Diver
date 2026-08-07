import Phaser from "phaser";
import { Party, PartyMember } from "../net/Party";
import { LocalPlayer } from "../entities/LocalPlayer";
import {
  KeyboardInputSource,
  GamepadInputSource,
  CombinedInputSource,
  InputSource,
} from "./InputSource";

/**
 * The Phaser half of same-screen co-op: one LocalPlayer view per connection the
 * Party already holds.
 *
 * It no longer dials the server. Connections are made in the lobby (see
 * net/Party) because that is where the party is assembled — by the time a scene
 * exists to draw them, everyone has been connected for as long as it took the
 * host to press Start.
 *
 * Input devices are assigned by seat order: seat 0 reads the keyboard OR the
 * first controller (P1 can use either), and every couch seat after it claims the
 * next controller.
 */
/** Is the given world point (a player's foot position) on a walkable tile? Used by
 *  local-player movement prediction to stop at walls the way the server does. */
export type WalkableAt = (x: number, y: number) => boolean;

export class LocalPlayerManager {
  private scene: Phaser.Scene;
  private party: Party;
  private localPlayers: LocalPlayer[] = [];
  private walkableAt: WalkableAt;

  constructor(scene: Phaser.Scene, party: Party, walkableAt: WalkableAt) {
    this.scene = scene;
    this.party = party;
    this.walkableAt = walkableAt;
  }

  /** Build a view for every party member, in seat order. */
  buildAll(x: number, y: number): LocalPlayer[] {
    return this.party.members.map((member, index) => this.build(member, index, x, y));
  }

  private build(member: PartyMember, index: number, x: number, y: number): LocalPlayer {
    const player = new LocalPlayer(
      this.scene,
      x,
      y,
      member.room,
      this.inputSourceFor(index),
      member.loadout.characterClass,
      member.loadout.characterType,
      this.walkableAt,
    );
    this.localPlayers.push(player);
    return player;
  }

  private inputSourceFor(index: number): InputSource {
    // Seat 0 drives from the keyboard OR the first controller, interchangeably,
    // so a solo player can pick up an Xbox pad and just play. Each couch player
    // after P1 claims the next controller (seat 1 → pad 1, seat 2 → pad 2, …);
    // P1's pad 0 is theirs alone.
    if (index === 0) {
      return new CombinedInputSource(
        new KeyboardInputSource(this.scene.input.keyboard!),
        new GamepadInputSource(this.scene, 0),
      );
    }
    return new GamepadInputSource(this.scene, index);
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

  /** Centroid of the local players still standing, or null if the whole local
   *  party is downed. The camera prefers this so a frozen corpse never drags the
   *  view off the survivor — and an all-downed local party (null) falls back to
   *  spectating a living teammate rather than staring at the floor. */
  getLivingCentroid(): { x: number; y: number } | null {
    const living = this.localPlayers.filter((p) => !p.downed);
    if (living.length === 0) return null;
    const sum = living.reduce(
      (acc, p) => ({ x: acc.x + p.sprite.x, y: acc.y + p.sprite.y }),
      { x: 0, y: 0 },
    );
    return { x: sum.x / living.length, y: sum.y / living.length };
  }

  /** Drop the sprites AND the connections behind them — abandoning a run leaves
   *  the room for real, so the party can go back to the menu and start another. */
  async leaveAll() {
    this.localPlayers.forEach((p) => p.destroy());
    this.localPlayers = [];
    await this.party.leaveAll();
  }
}
