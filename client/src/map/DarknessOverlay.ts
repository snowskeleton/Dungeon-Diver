import Phaser from "phaser";
import { ROOM_W, ROOM_H, TILE_SIZE } from "shared";

// The dark room's vision limit. Purely a client-side visual — enemies see, aggro
// and hit exactly as they always do, and the server knows nothing about it. That
// is deliberate: the client already regenerates the dungeon locally (same seed,
// same room types), so it can decide "this room is dark" on its own with no
// schema field and no sync, the same way the camera room-lock does.
//
// Drawn as a room-sized RenderTexture filled near-black, with a soft light erased
// out of it at the party's position. Depth sits above sprites (2–2.5), so enemies
// are swallowed by the dark; the HUD is on a separate camera drawn after the world
// one (see ui/UiLayer.ts), so the HP readout and challenge banner stay legible
// regardless of depth.
//
// The texture lives in WORLD space, not screen space. A scrollFactor(0) overlay
// looks right at zoom 1 and is wrong at any other zoom — the camera scales it
// about the viewport centre, so at the game's 2× it renders double-size and
// displaced. Anchoring to the room means no screen conversion exists to get
// wrong, and the camera handles it like any other world object. (The HUD hit the
// same trap; UiLayer is the general fix, but this overlay is genuinely world
// content and stays where it is.)

const DEPTH = 5;
/** How black the unlit part of the room gets. 1 = no vision at all. */
const DARKNESS = 0.94;
/** Radii in WORLD px: full visibility, then the fade's outer edge. At the game's
 *  2× zoom these read as roughly 80 and 180 screen px. */
const LIGHT_CORE = 40;
const LIGHT_EDGE = 90;
const TEX_KEY = "__darkness_light";

export class DarknessOverlay {
  private scene: Phaser.Scene;
  private rt: Phaser.GameObjects.RenderTexture;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    if (!scene.textures.exists(TEX_KEY)) DarknessOverlay.buildLightTexture(scene);

    this.rt = scene.add
      .renderTexture(0, 0, ROOM_W * TILE_SIZE, ROOM_H * TILE_SIZE)
      .setOrigin(0)
      .setDepth(DEPTH)
      .setVisible(false);
  }

  /** A radial gradient, opaque at the centre and transparent at the rim. Erasing
   *  with it punches a soft-edged hole rather than a hard circle. */
  private static buildLightTexture(scene: Phaser.Scene) {
    const size = LIGHT_EDGE * 2;
    const canvas = scene.textures.createCanvas(TEX_KEY, size, size);
    if (!canvas) return;
    const ctx = canvas.getContext();
    const grad = ctx.createRadialGradient(
      LIGHT_EDGE, LIGHT_EDGE, 0,
      LIGHT_EDGE, LIGHT_EDGE, LIGHT_EDGE,
    );
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(LIGHT_CORE / LIGHT_EDGE, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
  }

  /** `dark` is whether the party's current room is a dark one; x/y are their
   *  world-space centroid; roomX/roomY are that room's top-left world corner
   *  (the camera lock has already computed them). */
  update(dark: boolean, x: number, y: number, roomX: number, roomY: number) {
    if (!dark) {
      if (this.visible) {
        this.visible = false;
        this.rt.setVisible(false);
      }
      return;
    }
    this.visible = true;
    this.rt.setVisible(true);
    this.rt.setPosition(roomX, roomY);

    this.rt.clear();
    this.rt.fill(0x000000, DARKNESS);
    this.rt.erase(TEX_KEY, x - roomX - LIGHT_EDGE, y - roomY - LIGHT_EDGE);
  }

  destroy() {
    this.rt.destroy();
  }
}
