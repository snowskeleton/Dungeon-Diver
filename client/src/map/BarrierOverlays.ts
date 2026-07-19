import Phaser from "phaser";
import { BarrierRect, TILE_SIZE, tileCenter } from "shared";

/**
 * The tiled images drawn over locked doorways.
 *
 * This was two Maps, a build helper and three message handlers that each
 * destroyed-and-deleted by hand in GameScene — a hand-rolled entity view. It's
 * now one class with the same shape as the other in-world views.
 *
 * Parent and child barriers are tracked separately because they're raised and
 * dropped by different events: a parent barrier blocks advancing out of an
 * uncleared room, a child barrier blocks retreating back out of one you entered.
 * Both are keyed by connection id, which is what the server's unlock broadcasts
 * carry.
 */
export class BarrierOverlays {
  private readonly parent = new Map<string, Phaser.GameObjects.Image[]>();
  private readonly child = new Map<string, Phaser.GameObjects.Image[]>();

  constructor(private readonly scene: Phaser.Scene) {}

  showParent(connId: string, rect: BarrierRect): void {
    this.show(this.parent, connId, rect);
  }

  showChild(connId: string, rect: BarrierRect): void {
    this.show(this.child, connId, rect);
  }

  hideParent(connId: string): void {
    this.hide(this.parent, connId);
  }

  hideChild(connId: string): void {
    this.hide(this.child, connId);
  }

  /** Drop every overlay — a floor change rebuilds them all from the new map. */
  clear(): void {
    this.parent.forEach((imgs) => imgs.forEach((img) => img.destroy()));
    this.parent.clear();
    this.child.forEach((imgs) => imgs.forEach((img) => img.destroy()));
    this.child.clear();
  }

  private show(
    into: Map<string, Phaser.GameObjects.Image[]>,
    connId: string,
    rect: BarrierRect,
  ): void {
    // Replacing an existing overlay would otherwise orphan its images.
    this.hide(into, connId);
    into.set(connId, this.buildImages(rect));
  }

  private hide(from: Map<string, Phaser.GameObjects.Image[]>, connId: string): void {
    from.get(connId)?.forEach((img) => img.destroy());
    from.delete(connId);
  }

  /** One image per tile the barrier rect covers. */
  private buildImages(rect: BarrierRect): Phaser.GameObjects.Image[] {
    const images: Phaser.GameObjects.Image[] = [];
    const colMin = Math.floor((rect.cx - rect.w / 2) / TILE_SIZE);
    const colMax = Math.floor((rect.cx + rect.w / 2 - 1) / TILE_SIZE);
    const rowMin = Math.floor((rect.cy - rect.h / 2) / TILE_SIZE);
    const rowMax = Math.floor((rect.cy + rect.h / 2 - 1) / TILE_SIZE);
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const { x, y } = tileCenter(col, row);
        const img = this.scene.add.image(x, y, "barrier_tile");
        img.setDepth(1.5);
        images.push(img);
      }
    }
    return images;
  }
}
