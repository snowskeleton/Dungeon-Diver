import { SyncedList } from "../stateViews";
import { Unsubscribe } from "./Observable";

/**
 * The drop-in for Colyseus `ArraySchema`. Satisfies the client-facing `SyncedList`
 * contract (iterable, length, at, forEach) plus `onAdd` (which the client reaches via
 * a cast for offer.consumed / claimedBy) and the server-facing mutations (push,
 * splice). Lists are re-encoded whole for the delta (they are short — weapons,
 * upgrades, offer choices, mod labels — so per-index diffing isn't worth it); `dirty`
 * flags that a re-encode is due.
 *
 * onAdd(cb, triggerAll=true) fires for every element ALREADY present, then for each
 * future `push`ed element — matching Colyseus.
 */
export class ObservableList<T> implements SyncedList<T> {
  private readonly arr: T[] = [];
  private addCbs?: Set<(item: T, index: number) => void>;
  private _dirty = false;

  onAdd(cb: (item: T, index: number) => void, triggerAll = true): Unsubscribe {
    (this.addCbs ??= new Set()).add(cb);
    if (triggerAll) this.arr.forEach((v, i) => cb(v, i));
    return () => {
      this.addCbs?.delete(cb);
    };
  }

  push(...items: T[]): number {
    for (const item of items) {
      this.arr.push(item);
      this._dirty = true;
      this.addCbs?.forEach((cb) => cb(item, this.arr.length - 1));
    }
    return this.arr.length;
  }

  /** Remove `deleteCount` elements at `start`, returning them (like Array.splice).
   *  No onRemove — the client re-diffs lists (by weapon uid, etc.) rather than
   *  listening for element removal. */
  splice(start: number, deleteCount = this.arr.length - start): T[] {
    const removed = this.arr.splice(start, deleteCount);
    if (removed.length > 0) this._dirty = true;
    return removed;
  }

  at(index: number): T | undefined {
    return this.arr.at(index);
  }

  get length(): number {
    return this.arr.length;
  }

  forEach(cb: (value: T, index: number, list: unknown) => void): void {
    this.arr.forEach((v, i) => cb(v, i, this));
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.arr[Symbol.iterator]();
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
