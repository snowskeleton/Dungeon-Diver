import Phaser from "phaser";
import {
  DungeonResult, RoomData, TILE_SIZE, ROOM_W, ROOM_H,
} from "shared";
import { UiLayer } from "./UiLayer";

/**
 * The Zelda-style dungeon minimap: a compact grid of the floor's rooms in the
 * top-right corner, colour-coded by status, with the party's current room and
 * a live player marker.
 *
 * It is entirely client-side, and it can be, for the same reason the darkness
 * overlay is: the client regenerates the exact dungeon the server did from the
 * shared seed, so it already holds every room, connection, exit and boss cell.
 * The only things it can't derive locally are "have we been here" (explored) and
 * "is this room's advance-barrier down" (cleared) — GameScene tracks those two
 * from the movement it already computes and the barrier messages it already
 * handles, and passes them into update().
 *
 * Lives on the UiLayer (the zoom-1 UI camera). setScrollFactor(0) is NOT a
 * substitute — it does not exempt an object from the world camera's 2x zoom, so
 * a screen-space HUD element added to the world camera renders double-size and
 * displaced (see UiLayer / DarknessOverlay for the full account).
 */

/** Everything GameScene knows about room status, handed in each update. */
export interface MinimapStatus {
  currentRoomId: string;
  explored: Set<string>;
  cleared: Set<string>;
}

const MARGIN = 10;
/** Side of one room square, in screen px. */
const CELL = 13;
/** Gap between adjacent room squares. */
const GAP = 4;
const PAD = 6;

const DEPTH = 40;

const COLORS = {
  panel: 0x0b0b16,
  connector: 0x3a3a52,
  unexplored: 0x23233a,
  cleared: 0x3f7050,
  locked: 0x9a6f34,
  exit: 0x4a7ad0,
  boss: 0xb03a3a,
  currentBorder: 0xffffff,
  marker: 0xffe066,
} as const;

export class Minimap {
  private readonly scene: Phaser.Scene;
  private readonly ui: UiLayer;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly structure: Phaser.GameObjects.Graphics;
  private readonly marker: Phaser.GameObjects.Graphics;
  private glyphs = new Map<string, Phaser.GameObjects.Text>();

  private dungeon: DungeonResult | null = null;
  private gridCols = 0;
  private gridRows = 0;
  /** Top-left screen origin of the grid (inside the panel). */
  private originX = 0;
  private originY = 0;
  /** The last (status, room) pair drawn, so structure only redraws on change. */
  private lastKey = "";

  constructor(scene: Phaser.Scene, ui: UiLayer) {
    this.scene = scene;
    this.ui = ui;
    this.panel = ui.add(
      scene.add
        .rectangle(0, 0, 10, 10, COLORS.panel, 0.72)
        .setOrigin(0)
        .setDepth(DEPTH)
        .setVisible(false),
    );
    this.structure = ui.add(scene.add.graphics().setDepth(DEPTH + 1));
    this.marker = ui.add(scene.add.graphics().setDepth(DEPTH + 2));
  }

  /** Lay out the panel for a new floor's dungeon. Call on every floor change. */
  rebuild(dungeon: DungeonResult): void {
    this.dungeon = dungeon;
    this.gridCols = Math.round(dungeon.cols / ROOM_W);
    this.gridRows = Math.round(dungeon.rows / ROOM_H);

    const gridW = this.gridCols * CELL + (this.gridCols - 1) * GAP;
    const gridH = this.gridRows * CELL + (this.gridRows - 1) * GAP;
    const panelW = gridW + PAD * 2;
    const panelH = gridH + PAD * 2;
    const panelX = this.scene.scale.width - panelW - MARGIN;
    const panelY = MARGIN;

    this.panel.setPosition(panelX, panelY).setSize(panelW, panelH).setVisible(true);
    this.originX = panelX + PAD;
    this.originY = panelY + PAD;

    // Rebuild the exit/boss glyphs from scratch — the room ids change per floor.
    this.glyphs.forEach((g) => g.destroy());
    this.glyphs.clear();
    for (const room of dungeon.rooms) {
      const glyph = this.glyphFor(dungeon, room);
      if (glyph) this.glyphs.set(room.id, glyph);
    }

    this.lastKey = "";
    this.marker.clear();
  }

  /** Which marker glyph, if any, a room carries — stairs on the exit, a skull on
   *  the boss. Hidden until the room is explored so the map still holds a little
   *  discovery. */
  private glyphFor(dungeon: DungeonResult, room: RoomData): Phaser.GameObjects.Text | null {
    let char = "";
    if (room.id === dungeon.exitRoomId) char = "▼"; // ▼ stairs down
    else if (room.id === dungeon.bossRoomId) char = "☠"; // ☠ boss
    if (!char) return null;
    const { cx, cy } = this.cellCenter(room);
    return this.ui.add(
      this.scene.add
        .text(cx, cy, char, { fontSize: "11px", color: "#ffffff" })
        .setOrigin(0.5)
        .setDepth(DEPTH + 2)
        .setVisible(false),
    );
  }

  /** Top-left screen corner of a room's cell square. */
  private cellCorner(room: RoomData): { x: number; y: number } {
    return {
      x: this.originX + room.gx * (CELL + GAP),
      y: this.originY + room.gy * (CELL + GAP),
    };
  }

  private cellCenter(room: RoomData): { cx: number; cy: number } {
    const { x, y } = this.cellCorner(room);
    return { cx: x + CELL / 2, cy: y + CELL / 2 };
  }

  private roomFill(room: RoomData, status: MinimapStatus): number {
    if (room.id === status.currentRoomId) return this.brighten(this.baseFill(room, status));
    return this.baseFill(room, status);
  }

  private baseFill(room: RoomData, status: MinimapStatus): number {
    if (!status.explored.has(room.id)) return COLORS.unexplored;
    if (this.dungeon && room.id === this.dungeon.exitRoomId) return COLORS.exit;
    if (this.dungeon && room.id === this.dungeon.bossRoomId) return COLORS.boss;
    return status.cleared.has(room.id) ? COLORS.cleared : COLORS.locked;
  }

  private brighten(color: number): number {
    const r = Math.min(255, ((color >> 16) & 0xff) + 60);
    const g = Math.min(255, ((color >> 8) & 0xff) + 60);
    const b = Math.min(255, (color & 0xff) + 60);
    return (r << 16) | (g << 8) | b;
  }

  /** Recolour the grid for the current status. Cheap no-op unless something the
   *  map shows actually changed. */
  update(status: MinimapStatus): void {
    if (!this.dungeon) return;
    const key = this.statusKey(status);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.structure;
    g.clear();

    // Connectors first, under the room squares. Both endpoints must be explored
    // for a passage to show — an undiscovered door stays hidden.
    g.lineStyle(2, COLORS.connector, 1);
    for (const conn of this.dungeon.connections) {
      if (!status.explored.has(conn.parentRoomId)) continue;
      if (!status.explored.has(conn.childRoomId)) continue;
      const parent = this.roomById(conn.parentRoomId);
      const child = this.roomById(conn.childRoomId);
      if (!parent || !child) continue;
      const a = this.cellCenter(parent);
      const b = this.cellCenter(child);
      g.lineBetween(a.cx, a.cy, b.cx, b.cy);
    }

    for (const room of this.dungeon.rooms) {
      const { x, y } = this.cellCorner(room);
      g.fillStyle(this.roomFill(room, status), 1);
      g.fillRect(x, y, CELL, CELL);
      if (room.id === status.currentRoomId) {
        g.lineStyle(2, COLORS.currentBorder, 1);
        g.strokeRect(x - 1, y - 1, CELL + 2, CELL + 2);
      }
    }

    // Reveal each glyph once its room is explored.
    for (const [roomId, glyph] of this.glyphs) {
      glyph.setVisible(status.explored.has(roomId));
    }
  }

  /** A one-string digest of everything the drawn map depends on. */
  private statusKey(status: MinimapStatus): string {
    return [
      status.currentRoomId,
      status.explored.size,
      status.cleared.size,
    ].join("|");
  }

  private roomById(id: string): RoomData | undefined {
    return this.dungeon?.rooms.find((r) => r.id === id);
  }

  /** A small dot for the party inside its current room cell, positioned from the
   *  world centroid. Redrawn every frame — the party moves continuously, while
   *  the coloured grid only changes when a room's status does. */
  updateMarker(worldX: number, worldY: number): void {
    if (!this.dungeon) return;
    this.marker.clear();

    const gx = Math.floor(worldX / (ROOM_W * TILE_SIZE));
    const gy = Math.floor(worldY / (ROOM_H * TILE_SIZE));
    if (gx < 0 || gx >= this.gridCols || gy < 0 || gy >= this.gridRows) return;

    // Fraction across the room the party sits at, so the dot slides as they walk.
    const fx = (worldX - gx * ROOM_W * TILE_SIZE) / (ROOM_W * TILE_SIZE);
    const fy = (worldY - gy * ROOM_H * TILE_SIZE) / (ROOM_H * TILE_SIZE);
    const cornerX = this.originX + gx * (CELL + GAP);
    const cornerY = this.originY + gy * (CELL + GAP);
    const px = cornerX + Phaser.Math.Clamp(fx, 0.1, 0.9) * CELL;
    const py = cornerY + Phaser.Math.Clamp(fy, 0.1, 0.9) * CELL;

    this.marker.fillStyle(COLORS.marker, 1);
    this.marker.fillCircle(px, py, 2);
  }

  setVisible(visible: boolean): void {
    this.panel.setVisible(visible);
    this.structure.setVisible(visible);
    this.marker.setVisible(visible);
    if (!visible) this.glyphs.forEach((g) => g.setVisible(false));
  }

  destroy(): void {
    this.panel.destroy();
    this.structure.destroy();
    this.marker.destroy();
    this.glyphs.forEach((g) => g.destroy());
    this.glyphs.clear();
  }
}
