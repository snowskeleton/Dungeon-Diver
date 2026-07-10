import Phaser from "phaser";
import { DebugConfig } from "shared";
import { LaunchConfig, pickLoadout } from "../launch";
import { showFieldPanel } from "../ui/FieldPanel";
import { DEBUG_FIELDS, DEBUG_PRESETS, loadDebugConfig, saveDebugConfig } from "../debug/debugFields";
import { GameOptions, OPTION_FIELDS, loadOptions, saveOptions } from "../options/gameOptions";

interface MenuItem {
  label: string;
  run: () => void | Promise<void>;
}

const TITLE_Y = 170;
const FIRST_ITEM_Y = 300;
const ITEM_SPACING = 44;

export class MenuScene extends Phaser.Scene {
  private items: MenuItem[] = [];
  private itemTexts: Phaser.GameObjects.Text[] = [];
  private cursor!: Phaser.GameObjects.Text;
  private selected = 0;
  // True while a DOM panel or picker owns input, so keys don't drive the menu.
  private modalOpen = false;

  constructor() {
    super({ key: "MenuScene" });
  }

  create() {
    // Scenes are reused across restarts; drop anything the previous run created.
    this.itemTexts = [];
    this.selected = 0;
    this.modalOpen = false;
    this.input.keyboard!.removeAllKeys(true);

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
      { label: "Start", run: () => this.startGame(null) },
      { label: "Options", run: () => this.openOptions() },
      { label: "Debug", run: () => this.openDebug() },
    ];

    this.items.forEach((item, i) => {
      const text = this.add
        .text(400, FIRST_ITEM_Y + i * ITEM_SPACING, item.label, {
          fontSize: "24px", color: "#e0e0ff",
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      text.on("pointerover", () => this.select(i));
      text.on("pointerdown", () => this.activate());
      this.itemTexts.push(text);
    });

    this.cursor = this.add.text(0, 0, "▶", { fontSize: "20px", color: "#f6e05e" }).setOrigin(0.5);
    this.tweens.add({
      targets: this.cursor, alpha: { from: 1, to: 0.35 },
      duration: 600, yoyo: true, repeat: -1,
    });

    this.add
      .text(400, 520, "↑ ↓ to choose   ·   Enter to select", {
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

  /** Character + weapon pickers, then hand off to GameScene. */
  private async startGame(debug: DebugConfig | null) {
    const loadout = await pickLoadout("Player 1");
    if (!loadout) return; // cancelled — stay on the menu
    const config: LaunchConfig = { debug, loadout };
    this.scene.start("GameScene", config);
  }

  private async openOptions() {
    const result = await showFieldPanel<GameOptions>({
      title: "Options",
      fields: OPTION_FIELDS,
      initial: loadOptions(),
      buttons: [
        { id: "cancel", label: "Back" },
        { id: "save", label: "Save", primary: true },
      ],
    });
    if (result.button === "save") saveOptions(result.values);
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
    await this.startGame(debug);
  }
}
