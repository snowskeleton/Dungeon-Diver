import Phaser from "phaser";
import { Party, PartyMember } from "../net/Party";
import { LocalPlayer } from "../entities/LocalPlayer";
import { KeyboardInputSource, GamepadInputSource, InputSource } from "./InputSource";

/**
 * The Phaser half of same-screen co-op: one LocalPlayer view per connection the
 * Party already holds.
 *
 * It no longer dials the server. Connections are made in the lobby (see
 * net/Party) because that is where the party is assembled — by the time a scene
 * exists to draw them, everyone has been connected for as long as it took the
 * host to press Start.
 *
 * Input devices are assigned by seat order: P1 WASD, P2 arrows, P3/P4 gamepads.
 */
export class LocalPlayerManager {
  private scene: Phaser.Scene;
  private party: Party;
  private localPlayers: LocalPlayer[] = [];

  constructor(scene: Phaser.Scene, party: Party) {
    this.scene = scene;
    this.party = party;
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
      member.loadout.weaponId,
    );
    this.localPlayers.push(player);
    return player;
  }

  private inputSourceFor(index: number): InputSource {
    if (index === 0) return new KeyboardInputSource(this.scene.input.keyboard!, "wasd");
    if (index === 1) return new KeyboardInputSource(this.scene.input.keyboard!, "arrows");
    return new GamepadInputSource(this.scene, index - 2);
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

  /** Drop the sprites AND the connections behind them — abandoning a run leaves
   *  the room for real, so the party can go back to the menu and start another. */
  async leaveAll() {
    this.localPlayers.forEach((p) => p.destroy());
    this.localPlayers = [];
    await this.party.leaveAll();
  }
}
