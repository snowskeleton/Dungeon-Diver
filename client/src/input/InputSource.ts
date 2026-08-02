import { InputMessage } from "shared";
import { BindableAction, bindingsVersion, loadBindings } from "../options/keybindings";
import { noteInputActivity } from "./inputMode";

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
      this.keys[action] = bindings[action].keys
        .filter((code) => code)
        .map((code) => this.keyboard.addKey(code));
    }
    this.builtVersion = bindingsVersion();
  }

  private down(action: BindableAction): boolean {
    if (this.builtVersion !== bindingsVersion()) this.rebuild();
    const held = this.keys[action]?.some((key) => key.isDown) ?? false;
    if (held) noteInputActivity("kbd");
    return held;
  }

  read(): InputMessage {
    const dx = (this.down("right") ? 1 : 0) - (this.down("left") ? 1 : 0);
    const dy = (this.down("down") ? 1 : 0) - (this.down("up") ? 1 : 0);
    return { dx, dy, attack: this.down("attack"), ability: this.down("ability") };
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

/**
 * Reads several sources at once and OR's them together — any source pressing a
 * control counts. Used for seat 0, so P1 can drive the game from the keyboard OR
 * the first controller interchangeably, switching between them mid-run without
 * any device-assignment step. Movement takes the first source reporting a
 * non-zero axis (so a resting stick doesn't cancel keyboard input, and vice
 * versa).
 */
export class CombinedInputSource implements InputSource {
  private sources: InputSource[];

  constructor(...sources: InputSource[]) {
    this.sources = sources;
  }

  read(): InputMessage {
    const reads = this.sources.map((s) => s.read());
    const active = reads.find((r) => r.dx !== 0 || r.dy !== 0);
    return {
      dx: active?.dx ?? 0,
      dy: active?.dy ?? 0,
      attack: reads.some((r) => r.attack),
      ability: reads.some((r) => r.ability),
    };
  }

  readActions(): InputActions {
    const reads = this.sources.map((s) => s.readActions());
    return {
      prevSlot: reads.some((r) => r.prevSlot),
      nextSlot: reads.some((r) => r.nextSlot),
      toggleMenu: reads.some((r) => r.toggleMenu),
      interact: reads.some((r) => r.interact),
    };
  }
}

// Below this stick tilt the left stick reads as centered — kills resting-thumb
// drift.
const STICK_DEADZONE = 0.15;

// The stick direction is snapped to one of 16 evenly-spaced headings (every
// 22.5°) rather than passed through raw: pure analog felt floaty, and 16 points is
// fine enough to feel free while still giving movement a crisp, repeatable
// heading. The server normalizes speed and facing compares |dx| vs |dy|, so only
// the (snapped) direction matters.
const SNAP_DIRECTIONS = 8;
function snapStick(x: number, y: number): { dx: number; dy: number } {
  const step = (2 * Math.PI) / SNAP_DIRECTIONS;
  const angle = Math.round(Math.atan2(y, x) / step) * step;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

export class GamepadInputSource implements InputSource {
  private padIndex: number;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, padIndex: number) {
    this.scene = scene;
    this.padIndex = padIndex;
  }

  private pad(): Phaser.Input.Gamepad.Gamepad | undefined {
    return this.scene.input.gamepad?.getPad(this.padIndex);
  }

  // Is the button bound to `action` currently pressed? Movement actions have no
  // button (they're the stick) and always read false here.
  private pressed(pad: Phaser.Input.Gamepad.Gamepad, action: BindableAction): boolean {
    const button = loadBindings()[action].pad;
    if (button < 0) return false;
    return pad.buttons[button]?.pressed ?? false;
  }

  read(): InputMessage {
    const pad = this.pad();
    if (!pad) return { dx: 0, dy: 0, attack: false, ability: false };

    const lx = pad.leftStick.x;
    const ly = pad.leftStick.y;
    const moving = Math.hypot(lx, ly) >= STICK_DEADZONE;
    const snapped = moving ? snapStick(lx, ly) : { dx: 0, dy: 0 };
    const { dx, dy } = snapped;

    const attack = this.pressed(pad, "attack");
    const ability = this.pressed(pad, "ability");
    if (moving || attack || ability) noteInputActivity("pad");

    return { dx, dy, attack, ability };
  }

  readActions(): InputActions {
    const pad = this.pad();
    if (!pad) return NO_ACTIONS;
    const actions: InputActions = {
      prevSlot: this.pressed(pad, "prevSlot"),
      nextSlot: this.pressed(pad, "nextSlot"),
      toggleMenu: this.pressed(pad, "menu"),
      interact: this.pressed(pad, "interact"),
    };
    if (actions.prevSlot || actions.nextSlot || actions.toggleMenu || actions.interact) {
      noteInputActivity("pad");
    }
    return actions;
  }
}
