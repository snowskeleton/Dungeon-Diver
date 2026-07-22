import Phaser from "phaser";
import { CharacterClass, CharacterType, GameStateView, PlayerStateView, LobbyErrorMessage } from "shared";
import { Party } from "../net/Party";
import { LobbyPanel, LobbySeat } from "../ui/LobbyPanel";
import { pickLoadout } from "../launch";
import { loadProfile, saveProfile, profileLoadout } from "../options/profile";
import { backdrop } from "../ui/sceneBackdrop";

export interface LobbySceneData {
  /** Already joined — the lobby renders a room it is in, it never dials one. */
  party: Party;
}

/**
 * Where a party is assembled: the roster, the loadouts, and the Start button.
 *
 * The room here is the same Colyseus room the run will be played in, so nothing
 * is handed over when it starts — the client just stops drawing a panel and
 * starts drawing a dungeon. `state.phase` flipping to "run" is the entire
 * signal, which means a player who joins two seconds before the host presses
 * Start is carried in by the same code path as one who has been waiting.
 */
export class LobbyScene extends Phaser.Scene {
  private party!: Party;
  private panel!: LobbyPanel;
  /** Guards the async pickers: a state patch arriving mid-pick must not rebuild
   *  the roster out from under an open modal's callbacks. */
  private picking = false;
  private launching = false;

  constructor() {
    super({ key: "LobbyScene" });
  }

  init(data: LobbySceneData) {
    this.party = data.party;
    this.picking = false;
    this.launching = false;
  }

  create() {
    backdrop(this, "LOBBY");
    const profile = loadProfile();

    this.panel = new LobbyPanel({
      onRename: (name) => this.rename(name),
      onChangeLoadout: (index) => void this.changeLoadout(index),
      onReady: (ready) => this.party.setReady(ready),
      onStart: () => this.party.startRun(),
      onAddCouch: () => void this.addCouch(),
      onLeave: () => void this.leave(),
    }, profile.name);

    const room = this.party.primary;
    room.onStateChange(() => this.refresh());
    room.onMessage("lobby_error", (msg: LobbyErrorMessage) => this.panel.setError(msg.reason));
    // A room the server tore down (host quit before anyone else joined, process
    // restart) must not leave the player staring at a lobby that can never start.
    room.onLeave(() => {
      if (this.launching) return;
      this.scene.start("MenuScene", { notice: "Disconnected from the room." });
    });

    this.input.keyboard!.removeAllKeys(true);
    // Phaser listens on the window, so without this guard typing a "p" into the
    // name field above would also open a character picker.
    this.input.keyboard!.addKey("P").on("down", () => {
      if (document.activeElement instanceof HTMLInputElement) return;
      void this.addCouch();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.panel.destroy());
    this.refresh();
  }

  /** Rebuild the roster from the room state — and leave for the run the moment
   *  the server says it has started. */
  private refresh() {
    if (this.launching) return;
    const state = this.party.state;
    if (state.phase === "run") {
      this.startRun();
      return;
    }

    const localSessionIds = this.party.members.map((m) => m.room.sessionId);
    const seats: LobbySeat[] = [];
    state.players.forEach((player: PlayerStateView, sessionId: string) => {
      seats.push({
        sessionId,
        name: player.name,
        characterClass: player.characterClass as CharacterClass,
        characterType: player.characterType as CharacterType,
        weaponId: player.weaponId,
        ready: player.ready,
        isHost: sessionId === state.hostSessionId,
        localIndex: localSessionIds.indexOf(sessionId),
      });
    });

    const you = seats.find((s) => s.localIndex === 0);
    this.panel.render({
      roomName: state.roomName,
      roomCode: state.roomCode,
      isPrivate: state.isPrivate,
      seats,
      isHost: this.party.isHost,
      waitingOn: seats
        .filter((s) => !s.isHost && !s.ready)
        .map((s) => s.name),
      canAddCouch: !this.party.isFull,
      ready: you?.ready ?? false,
    });
  }

  private startRun() {
    this.launching = true;
    this.scene.start("GameScene", { party: this.party, debug: this.party.debug });
  }

  private rename(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveProfile({ ...loadProfile(), name: trimmed });
    this.party.setName(trimmed);
  }

  /** Re-run the character + weapon pickers for one local seat. */
  private async changeLoadout(index: number) {
    if (this.picking) return;
    this.picking = true;
    try {
      const current = this.party.members[index]?.loadout ?? profileLoadout();
      const loadout = await pickLoadout(`Player ${index + 1}`, current);
      if (!loadout) return;
      this.party.setLoadout(index, loadout);
      // Seat 0 is this machine's own player, so its choice is the one worth
      // remembering for next time; couch seats are per-session.
      if (index === 0) saveProfile({ ...loadProfile(), ...loadout });
    } finally {
      this.picking = false;
      this.refresh();
    }
  }

  /** Add a second-to-fourth player on this machine. They join the same room as
   *  their own connection, which is what makes couch and online co-op the same
   *  thing from the server's side. */
  private async addCouch() {
    if (this.picking || this.party.isFull) return;
    this.picking = true;
    try {
      const seat = this.party.members.length + 1;
      const loadout = await pickLoadout(`Player ${seat}`, profileLoadout());
      if (!loadout) return;
      await this.party.addCouch(loadout);
    } catch {
      this.panel.setError("Couldn't add another player.");
    } finally {
      this.picking = false;
      this.refresh();
    }
  }

  private async leave() {
    this.launching = true; // suppress the onLeave → "disconnected" notice
    await this.party.leaveAll();
    this.scene.start("MenuScene");
  }
}
