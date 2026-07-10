import Phaser from "phaser";

export interface ClipDef {
  frames: number[];
  frameRate: number;
  repeat: number; // -1 loops, 0 plays once
}

/** Create each clip on the scene's AnimationManager unless it already exists.
 *  Shared by the humanoid/goo/bat sprite modules so they don't each reimplement
 *  the exists-guarded anims.create loop. */
export function defineClips(
  scene: Phaser.Scene,
  textureKey: string,
  clips: Record<string, ClipDef>,
): void {
  for (const [key, clip] of Object.entries(clips)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(textureKey, { frames: clip.frames }),
      frameRate: clip.frameRate,
      repeat: clip.repeat,
    });
  }
}
