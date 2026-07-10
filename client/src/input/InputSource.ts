import { InputMessage } from "shared";

// Discrete (non-movement) intents, reported as the CURRENT held state of each
// control. LocalPlayer edge-detects these into one-shot actions, so sources stay
// stateless. prevSlot/nextSlot cycle the active weapon; toggleMenu opens/closes
// the inventory/stats pause menu.
export interface InputActions {
  prevSlot: boolean;
  nextSlot: boolean;
  toggleMenu: boolean;
  interact: boolean;
}

export interface InputSource {
  read(): InputMessage;
  readActions(): InputActions;
}

const NO_ACTIONS: InputActions = { prevSlot: false, nextSlot: false, toggleMenu: false, interact: false };

export class KeyboardInputSource implements InputSource {
  private keys: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    attack: Phaser.Input.Keyboard.Key;
    prevSlot: Phaser.Input.Keyboard.Key;
    nextSlot: Phaser.Input.Keyboard.Key;
    menu: Phaser.Input.Keyboard.Key;
    interact: Phaser.Input.Keyboard.Key;
  };

  constructor(
    keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
    scheme: "wasd" | "arrows",
  ) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    if (scheme === "wasd") {
      this.keys = {
        up:     keyboard.addKey(K.W),
        down:   keyboard.addKey(K.S),
        left:   keyboard.addKey(K.A),
        right:  keyboard.addKey(K.D),
        attack: keyboard.addKey(K.SPACE),
        prevSlot: keyboard.addKey(K.Q),
        nextSlot: keyboard.addKey(K.E),
        menu:   keyboard.addKey(K.I),
        interact: keyboard.addKey(K.F),
      };
    } else {
      this.keys = {
        up:     keyboard.addKey(K.UP),
        down:   keyboard.addKey(K.DOWN),
        left:   keyboard.addKey(K.LEFT),
        right:  keyboard.addKey(K.RIGHT),
        attack: keyboard.addKey(K.ENTER),
        prevSlot: keyboard.addKey(K.OPEN_BRACKET),
        nextSlot: keyboard.addKey(K.CLOSED_BRACKET),
        menu:   keyboard.addKey(K.BACK_SLASH),
        interact: keyboard.addKey(K.PERIOD),
      };
    }
  }

  read(): InputMessage {
    const dx =
      (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    const dy =
      (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0);
    return { dx, dy, attack: this.keys.attack.isDown };
  }

  readActions(): InputActions {
    return {
      prevSlot: this.keys.prevSlot.isDown,
      nextSlot: this.keys.nextSlot.isDown,
      toggleMenu: this.keys.menu.isDown,
      interact: this.keys.interact.isDown,
    };
  }
}

export class GamepadInputSource implements InputSource {
  private padIndex: number;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, padIndex: number) {
    this.scene = scene;
    this.padIndex = padIndex;
  }

  read(): InputMessage {
    const pad = this.scene.input.gamepad?.getPad(this.padIndex);
    if (!pad) return { dx: 0, dy: 0, attack: false };

    const lx = pad.leftStick.x;
    const ly = pad.leftStick.y;
    const threshold = 0.2;

    const dx = Math.abs(lx) > threshold ? Math.sign(lx) : 0;
    const dy = Math.abs(ly) > threshold ? Math.sign(ly) : 0;
    const attack = pad.buttons[0]?.pressed ?? false; // A / Cross

    return { dx, dy, attack };
  }

  readActions(): InputActions {
    const pad = this.scene.input.gamepad?.getPad(this.padIndex);
    if (!pad) return NO_ACTIONS;
    return {
      prevSlot: pad.buttons[4]?.pressed ?? false, // L1
      nextSlot: pad.buttons[5]?.pressed ?? false, // R1
      toggleMenu: pad.buttons[9]?.pressed ?? false, // Start
      interact: pad.buttons[3]?.pressed ?? false, // Y / Triangle
    };
  }
}
