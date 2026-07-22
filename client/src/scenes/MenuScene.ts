import Phaser from "phaser";
import { DebugConfig } from "shared";
import { Party, JoinError } from "../net/Party";
import { showFieldPanel } from "../ui/FieldPanel";
import { showKeybindMenu } from "../ui/KeybindMenu";
import { DEBUG_FIELDS, DEBUG_PRESETS, loadDebugConfig, saveDebugConfig } from "../debug/debugFields";
import { GameOptions, OPTION_FIELDS, loadOptions, saveOptions } from "../options/gameOptions";
import { loadProfile, profileLoadout } from "../options/profile";

interface MenuItem {
  label: string;
  hint: string;
  run: () => void | Promise<void>;
}

export interface MenuSceneData {
  /** Shown under the menu — how a scene that bailed out explains itself. */
  notice?: string;
}

const TITLE_Y = 150;
const FIRST_ITEM_Y = 280;
const ITEM_SPACING = 46;

/**
 * The title screen, and the fork D8 asked for: solo or shared.
 *
 * Both forks land in the same place — a lobby, in a real room on the server —
 * because "solo" is a room nobody else can find, not a different code path. That
 * is what keeps couch co-op working (add players in the lobby) and what lets a
 * solo player open their run to a friend later without any of this changing.
 */
export class MenuScene extends Phaser.Scene {
  private items: MenuItem[] = [];
  private itemTexts: Phaser.GameObjects.Text[] = [];
  private hintText!: Phaser.GameObjects.Text;
  private noticeText!: Phaser.GameObjects.Text;
  private cursor!: Phaser.GameObjects.Text;
  private selected = 0;
  // True while a DOM panel, a picker, or a pending join owns input.
  private modalOpen = false;
  private notice = "";

  constructor() {
    super({ key: "MenuScene" });
  }

  init(data?: MenuSceneData) {
    this.notice = data?.notice ?? "";
  }

  create() {
    // Scenes are reused across restarts; drop anything the previous run created.
    this.itemTexts = [];
    this.selected = 0;
    this.modalOpen = false;
    this.input.keyboard!.removeAllKeys(true);
    this.cameras.main.setBackgroundColor("#0b0b16");

    this.add
      .text(400, TITLE_Y, "GAME 2", {
        fontSize: "64px", color: "#f6e05e", fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(400, TITLE_Y + 52, "a co-op dungeon crawler", {
        fontSize: "14px", color: "#8888aa",
      })
      .setOrigin(0.5);

    this.items = [
      {
        label: "Play Solo",
        hint: "A private room only you can see. Add couch players in the lobby.",
        run: () => this.hostRun(null, true),
      },
      {
        label: "Play Online",
        hint: "Browse open rooms, join by code, or host one of your own.",
        run: () => { this.scene.start("BrowseScene"); },
      },
      {
        label: "Options",
        hint: "Camera, overlays, and hints.",
        run: () => this.openOptions(),
      },
      {
        label: "Debug",
        hint: "Build a custom floor and start a private run on it.",
        run: () => this.openDebug(),
      },
    ];

    this.items.forEach((item, i) => {
      const text = this.add
        .text(400, FIRST_ITEM_Y + i * ITEM_SPACING, item.label, {
          fontSize: "24px", color: "#e0e0ff",
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      text.on("pointerover", () => this.select(i));
      // Select on the way down as well as on hover: Phaser resolves pointer-over
      // in its update loop, which can run AFTER the down event of the same click,
      // so a click that arrives without a prior hover frame would otherwise
      // activate whatever was selected before — the mouse picking one entry and
      // the game running another.
      text.on("pointerdown", () => {
        this.select(i);
        void this.activate();
      });
      this.itemTexts.push(text);
    });

    this.hintText = this.add
      .text(400, FIRST_ITEM_Y + this.items.length * ITEM_SPACING + 8, "", {
        fontSize: "12px", color: "#777799", align: "center",
      })
      .setOrigin(0.5);

    this.noticeText = this.add
      .text(400, 500, this.notice, { fontSize: "12px", color: "#ff8888" })
      .setOrigin(0.5);

    this.cursor = this.add.text(0, 0, "▶", { fontSize: "20px", color: "#f6e05e" }).setOrigin(0.5);
    this.tweens.add({
      targets: this.cursor, alpha: { from: 1, to: 0.35 },
      duration: 600, yoyo: true, repeat: -1,
    });

    this.add
      .text(400, 540, "↑ ↓ to choose   ·   Enter to select", {
        fontSize: "12px", color: "#555577",
      })
      .setOrigin(0.5);

    const keyboard = this.input.keyboard!;
    keyboard.on("keydown-UP", () => this.select(this.selected - 1));
    keyboard.on("keydown-DOWN", () => this.select(this.selected + 1));
    keyboard.on("keydown-W", () => this.select(this.selected - 1));
    keyboard.on("keydown-S", () => this.select(this.selected + 1));
    keyboard.on("keydown-ENTER", () => this.activate());
    keyboard.on("keydown-SPACE", () => this.activate());

    this.select(0);
  }

  private select(index: number) {
    if (this.modalOpen) return;
    const count = this.items.length;
    this.selected = ((index % count) + count) % count;
    this.itemTexts.forEach((text, i) => {
      const active = i === this.selected;
      text.setColor(active ? "#ffffff" : "#8888aa");
      text.setScale(active ? 1.1 : 1);
    });
    const active = this.itemTexts[this.selected];
    this.cursor.setPosition(active.x - active.displayWidth / 2 - 24, active.y);
    this.hintText.setText(this.items[this.selected].hint);
  }

  private async activate() {
    if (this.modalOpen) return;
    this.modalOpen = true;
    try {
      await this.items[this.selected].run();
    } finally {
      this.modalOpen = false;
    }
  }

  /** Open a room of our own and go to its lobby. Solo and Debug both land here:
   *  a run you host privately is the same room a stranger would have joined. */
  private async hostRun(debug: DebugConfig | null, isPrivate: boolean) {
    const profile = loadProfile();
    const party = new Party(profile.name, profileLoadout(profile));
    this.noticeText.setText("Connecting…");
    try {
      await party.host({
        roomName: `${profile.name}'s run`,
        isPrivate,
        debug,
      });
      this.scene.start("LobbyScene", { party });
    } catch (err) {
      this.noticeText.setText(
        err instanceof JoinError ? err.message : "Couldn't reach the server.",
      );
    }
  }

  private async openOptions() {
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
      // screen (it saves its own bindings), then reopen Options where we were.
      if (result.button === "keys") {
        initial = result.values;
        await showKeybindMenu();
        continue;
      }
      if (result.button === "save") saveOptions(result.values);
      break;
    }
  }

  private async openDebug() {
    const result = await showFieldPanel<DebugConfig>({
      title: "Debug — Custom Floor",
      fields: DEBUG_FIELDS,
      presets: DEBUG_PRESETS,
      initial: loadDebugConfig(),
      buttons: [
        { id: "cancel", label: "Back" },
        { id: "start", label: "Start Game", primary: true },
      ],
    });
    if (result.button !== "start") return;

    // The panel never shows `enabled` — reaching Start Game is what enables it.
    const debug: DebugConfig = { ...result.values, enabled: true };
    saveDebugConfig(debug);
    await this.hostRun(debug, true);
  }
}
