import { InputMessage } from "shared";
import { BindableAction, bindingsVersion, loadBindings } from "../options/keybindings";

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
  // Up to two Phaser Keys per action (Key 1 / Key 2); either being down fires
  // it, and an unbound (0) slot contributes no Key. The key set is rebuilt
  // whenever the saved bindings change (tracked by version), so a rebind from
  // the pause menu applies to the run in progress on the very next frame.
  private keys: Partial<Record<BindableAction, Phaser.Input.Keyboard.Key[]>> = {};
  private builtVersion = -1;

  constructor(private keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {}

  private rebuild() {
    const bindings = loadBindings();
    for (const action of Object.keys(bindings) as BindableAction[]) {
      this.keys[action] = bindings[action]
        .filter((code) => code)
        .map((code) => this.keyboard.addKey(code));
    }
    this.builtVersion = bindingsVersion();
  }

  private down(action: BindableAction): boolean {
    if (this.builtVersion !== bindingsVersion()) this.rebuild();
    return this.keys[action]?.some((key) => key.isDown) ?? false;
  }

  read(): InputMessage {
    const dx = (this.down("right") ? 1 : 0) - (this.down("left") ? 1 : 0);
    const dy = (this.down("down") ? 1 : 0) - (this.down("up") ? 1 : 0);
    return { dx, dy, attack: this.down("attack") };
  }

  readActions(): InputActions {
    return {
      prevSlot: this.down("prevSlot"),
      nextSlot: this.down("nextSlot"),
      toggleMenu: this.down("menu"),
      interact: this.down("interact"),
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
