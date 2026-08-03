/**
 * The tiny observable-state primitive that replaces `@colyseus/schema`.
 *
 * Colyseus gave us two things we actually used: change callbacks the client renders
 * off (`onChange`/`onAdd`/`onRemove`), and dirty tracking for delta encoding. This
 * reproduces exactly that, with no transport attached — so the same state object
 * works three ways: mutated in the sim, watched in-process by the client (the solo
 * LocalAuthority, Phase 4), and diffed into a wire delta (P2P replication, Phase 5).
 *
 * `Observable` is the per-object base (a schema row); `@tracked` marks a field so
 * assigning it fires `onChange` and records the field as dirty — the drop-in for
 * `@type`. Collections live alongside in ObservableMap / ObservableList.
 *
 * Robustness note: `@type` assumed `useDefineForClassFields: false` (field
 * initializers ASSIGN, hitting a setter). That holds in production (target ES2020)
 * but not under every test/build transform (ES2022 defaults it true, redefining the
 * field as an own data property and shadowing a prototype accessor). To work in every
 * environment, the base wraps each instance in a Proxy that traps BOTH `set`
 * (assignment) and `defineProperty` (define-semantics initializers) — so a tracked
 * field notifies no matter how the transform emits it.
 *
 * onChange fires SYNCHRONOUSLY on each tracked-field change. The client's change
 * handlers read whole-object state and are idempotent, so this is correct; batching
 * to one callback per tick is a later optimization.
 */
export type Unsubscribe = () => void;

// Per-class registry of tracked field names, keyed by the class constructor. Filled
// by the `@tracked` decorator at class-definition time; consulted (up the constructor
// chain) by the Proxy traps to decide whether a write should notify.
const trackedFields = new WeakMap<Function, Set<string>>();

function registerTracked(ctor: Function, field: string): void {
  let set = trackedFields.get(ctor);
  if (!set) {
    set = new Set();
    trackedFields.set(ctor, set);
  }
  set.add(field);
}

function isTracked(instance: object, field: string): boolean {
  let ctor: Function | null = instance.constructor;
  while (ctor && ctor !== Observable && ctor !== Object) {
    if (trackedFields.get(ctor)?.has(field)) return true;
    ctor = Object.getPrototypeOf(ctor);
  }
  return false;
}

/** The union of tracked field names for an instance, up its constructor chain. */
export function trackedKeysOf(instance: object): Set<string> {
  const keys = new Set<string>();
  let ctor: Function | null = instance.constructor;
  while (ctor && ctor !== Observable && ctor !== Object) {
    trackedFields.get(ctor)?.forEach((k) => keys.add(k));
    ctor = Object.getPrototypeOf(ctor);
  }
  return keys;
}

export abstract class Observable {
  /** Change subscribers. Lazily allocated — most rows are never watched. */
  private _changeCbs?: Set<() => void>;
  /** Field names changed since the last consumeDirty(), for delta encoding. */
  private _dirty?: Set<string>;

  constructor() {
    // Return a Proxy so tracked-field writes notify regardless of how the transform
    // emits field initializers. Writes store on the raw target; reads have no trap
    // (near-native). `instanceof` still works — the proxy shares the target's proto.
    const self = this;
    return new Proxy(this, {
      set(target, prop, value): boolean {
        const key = String(prop);
        const changed =
          typeof prop === "string" &&
          isTracked(target, key) &&
          (target as Record<string, unknown>)[key] !== value;
        (target as Record<string, unknown>)[key] = value;
        if (changed) self.$markChanged.call(target, key);
        return true;
      },
      defineProperty(target, prop, desc): boolean {
        const key = String(prop);
        const changed =
          typeof prop === "string" &&
          isTracked(target, key) &&
          "value" in desc &&
          (target as Record<string, unknown>)[key] !== desc.value;
        Object.defineProperty(target, prop, desc);
        if (changed) self.$markChanged.call(target, key);
        return true;
      },
    });
  }

  /** Watch this row for any tracked-field change. Returns an unsubscribe. Mirrors
   *  Colyseus `Schema.onChange`. */
  onChange(cb: () => void): Unsubscribe {
    (this._changeCbs ??= new Set()).add(cb);
    return () => {
      this._changeCbs?.delete(cb);
    };
  }

  /** @internal Called by the Proxy when a tracked field's value changes. Records the
   *  field dirty and notifies watchers. */
  $markChanged(field: string): void {
    (this._dirty ??= new Set()).add(field);
    this._changeCbs?.forEach((cb) => cb());
  }

  /** True if any tracked field has changed since the last consumeDirty(). */
  get isDirty(): boolean {
    return this._dirty !== undefined && this._dirty.size > 0;
  }

  /** Drain and return the names of fields changed since the last call. The delta
   *  encoder reads this; in-process callbacks don't need it. */
  consumeDirty(): Set<string> {
    const d = this._dirty ?? new Set<string>();
    this._dirty = undefined;
    return d;
  }
}

/**
 * Property decorator: the drop-in for Colyseus `@type(...)`. Registers the field as
 * tracked so the Observable Proxy notifies on change. The type argument is accepted
 * and ignored — it keeps call sites reading like `@type("number")` and documents the
 * wire type for the future delta encoder.
 */
export function tracked(_wireType?: unknown): PropertyDecorator {
  return (proto: object, key: string | symbol): void => {
    registerTracked((proto as { constructor: Function }).constructor, String(key));
  };
}
