import Phaser from "phaser";

// The HUD's camera.
//
// `setScrollFactor(0)` does NOT exempt an object from the camera's zoom — it only
// stops it scrolling. The world camera runs at 2× (DebugConfig.cameraZoom), which
// scales every object it draws about the viewport centre, so a HUD element at
// (8, 8) was being pushed far off-screen. It only became visible when the player
// walked to the edge of the map and the camera's scroll happened to bring the
// origin back into view — which is exactly the symptom that was reported.
//
// The fix is a second camera at zoom 1 that draws the HUD and nothing else, while
// the world camera draws the world and nothing of the HUD. Phaser cameras only
// have an ignore list (no whitelist), so the split is maintained from both ends:
//
//   - every object added to the scene is ignored by the UI camera by default, via
//     the ADDED_TO_SCENE hook, so new world content is handled without anyone
//     remembering to register it;
//   - add() reverses that for a single object and hides it from the world camera.
//
// Both directions are just the `cameraFilter` bitmask that Camera.ignore() sets,
// which is why add() works whether it runs before or after the object was created.
const byScene = new WeakMap<Phaser.Scene, UiLayer>();

export class UiLayer {
  readonly camera: Phaser.Cameras.Scene2D.Camera;
  private scene: Phaser.Scene;
  private world: Phaser.Cameras.Scene2D.Camera;

  /** The UI layer belonging to a scene, for code that is handed a bare Scene and
   *  would otherwise need it threaded down through several constructors (see
   *  AcquireFX, whose panel is screen-space while the rest of it is world-space). */
  static of(scene: Phaser.Scene): UiLayer | undefined {
    return byScene.get(scene);
  }

  constructor(scene: Phaser.Scene, width: number, height: number) {
    this.scene = scene;
    this.world = scene.cameras.main;
    byScene.set(scene, this);

    this.camera = scene.cameras.add(0, 0, width, height);
    this.camera.setName("ui");

    // A new camera draws everything by default, so anything built before this
    // point (the map, barrier overlays, the hitbox graphics) has to be swept.
    for (const obj of scene.children.list) this.camera.ignore(obj);

    scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private onAdded(obj: Phaser.GameObjects.GameObject) {
    this.camera.ignore(obj);
  }

  /** Claim an object for the HUD: drawn by the UI camera at zoom 1, in screen
   *  pixels, and no longer drawn by the world camera. */
  add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    obj.cameraFilter &= ~this.camera.id;
    obj.cameraFilter |= this.world.id;
    return obj;
  }

  destroy() {
    this.scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded, this);
    byScene.delete(this.scene);
  }
}
