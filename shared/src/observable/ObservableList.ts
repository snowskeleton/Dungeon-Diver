import { Unsubscribe } from "./Observable";

/**
 * The drop-in for Colyseus `ArraySchema` — which, like this, extends `Array`. That
 * gives numeric indexing (`list[0]`), `includes`, `entries`, `at`, `forEach`, and
 * iteration for free (all of which call sites and the client rely on), so this only
 * adds `onAdd` (the client reaches it via a cast on offer.consumed / claimedBy) and
 * overrides the two mutators the sim uses (`push`, `splice`) to fire callbacks and
 * flag the list dirty for the delta encoder. Lists are short (weapons, upgrades,
 * offer choices, mod labels), so they re-encode whole rather than per-index.
 *
 * onAdd(cb, triggerAll=true) fires for every element ALREADY present, then for each
 * future `push`ed element — matching Colyseus.
 */
export class ObservableList<T> extends Array<T> {
  // Derived arrays (splice's return value, map/filter results) are plain Arrays, not
  // ObservableLists — so they carry none of the bookkeeping below and compare cleanly.
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  // Non-enumerable-ish bookkeeping. Declared here; Array subclass fields initialise
  // after super(). (map/filter build a fresh list via Symbol.species with these at
  // their defaults, which is harmless — we never read callbacks off a derived list.)
  private addCbs?: Set<(item: T, index: number) => void>;
  private _dirty = false;

  onAdd(cb: (item: T, index: number) => void, triggerAll = true): Unsubscribe {
    (this.addCbs ??= new Set()).add(cb);
    if (triggerAll) this.forEach((v, i) => cb(v, i));
    return () => {
      this.addCbs?.delete(cb);
    };
  }

  override push(...items: T[]): number {
    for (const item of items) {
      super.push(item);
      this._dirty = true;
      this.addCbs?.forEach((cb) => cb(item, this.length - 1));
    }
    return this.length;
  }

  override splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    const removed =
      deleteCount === undefined
        ? super.splice(start)
        : super.splice(start, deleteCount, ...items);
    if (removed.length > 0 || items.length > 0) this._dirty = true;
    return removed;
  }

  /** True if the list changed since the last consumeDirty() (delta encoding). */
  get isDirty(): boolean {
    return this._dirty;
  }

  consumeDirty(): boolean {
    const was = this._dirty;
    this._dirty = false;
    return was;
  }
}
