import Phaser from "phaser";
import { RoomListing } from "shared";
import { Party, JoinError, listRooms } from "../net/Party";
import { RoomBrowserPanel } from "../ui/RoomBrowserPanel";
import { loadProfile, profileLoadout } from "../options/profile";
import { backdrop } from "../ui/sceneBackdrop";

/** How often the open-room list refreshes itself. Slow enough to be free, fast
 *  enough that a room someone just opened appears while you're still looking. */
const REFRESH_MS = 4000;

/**
 * Find a party, or start one others can find.
 *
 * Every path out of here ends in a joined room and a hop to LobbyScene, so this
 * scene owns the Party it creates: if a join fails the Party is discarded with
 * the attempt, and the player is still sitting on a browser that works.
 */
export class BrowseScene extends Phaser.Scene {
  private panel!: RoomBrowserPanel;
  private refreshTimer?: Phaser.Time.TimerEvent;
  /** True from the moment a join is dispatched, so a double-click (or a poll
   *  landing mid-join) can't open a second connection we would then leak. */
  private joining = false;

  constructor() {
    super({ key: "BrowseScene" });
  }

  create() {
    backdrop(this, "PLAY ONLINE");

    const profile = loadProfile();
    this.panel = new RoomBrowserPanel(
      {
        onJoin: (roomId) => this.attempt((party) => party.joinById(roomId)),
        onJoinByCode: (code) => this.attempt((party) => party.joinByCode(code)),
        onHost: (roomName, isPrivate) =>
          this.attempt((party) => party.host({
            roomName: roomName.trim() || `${profile.name}'s run`,
            isPrivate,
            debug: null,
          })),
        onRefresh: () => void this.refresh(),
        onBack: () => this.scene.start("MenuScene"),
      },
      `${profile.name}'s run`,
    );

    void this.refresh();
    this.refreshTimer = this.time.addEvent({
      delay: REFRESH_MS,
      loop: true,
      callback: () => void this.refresh(),
    });

    // Phaser reuses scene instances, so the DOM panel has to come down with the
    // scene or the next visit stacks a second one over it.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.refreshTimer?.remove();
      this.panel.destroy();
    });
  }

  private async refresh() {
    if (this.joining) return;
    try {
      const rooms: RoomListing[] = await listRooms();
      this.panel.renderRooms(rooms);
    } catch {
      this.panel.setNote("Couldn't reach the server.");
    }
  }

  /** Run a join/host attempt against a fresh Party and hand it to the lobby. */
  private async attempt(join: (party: Party) => Promise<void>) {
    if (this.joining) return;
    this.joining = true;
    this.panel.setNote("");
    this.panel.setBusy(true);

    const profile = loadProfile();
    const party = new Party(profile.name, profileLoadout(profile));
    try {
      await join(party);
      this.scene.start("LobbyScene", { party });
    } catch (err) {
      this.panel.setNote(err instanceof JoinError ? err.message : "Couldn't join that room.");
      this.panel.setBusy(false);
      this.joining = false;
    }
  }
}
