import { SyncedMap } from "../stateViews";
import { Unsubscribe } from "./Observable";

/**
 * The drop-in for Colyseus `MapSchema`. Satisfies the client-facing `SyncedMap`
 * contract (onAdd/onRemove/get/forEach/has/size) plus the server-facing mutations
 * (set/delete/clear). Keys added/removed since the last drain are recorded for the
 * delta encoder.
 *
 * Callback semantics match Colyseus exactly:
 *  - onAdd(cb, triggerAll=true) fires for every item ALREADY present when the
 *    callback registers (the load-bearing behaviour GameScene relies on), then for
 *    each future `set` of a NEW key.
 *  - `set` of an existing key is an update (no onAdd); the row's own onChange carries
 *    its field changes.
 *  - onRemove fires on `delete` (and on each entry cleared).
 */
export class ObservableMap<T> implements SyncedMap<T> {
  private readonly map = new Map<string, T>();
  private addCbs?: Set<(item: T, key: string) => void>;
  private removeCbs?: Set<(item: T, key: string) => void>;
  private readonly _added = new Set<string>();
  private readonly _removed = new Set<string>();

  onAdd(cb: (item: T, key: string) => void, triggerAll = true): Unsubscribe {
    (this.addCbs ??= new Set()).add(cb);
    if (triggerAll) this.map.forEach((v, k) => cb(v, k));
    return () => {
      this.addCbs?.delete(cb);
    };
  }

  onRemove(cb: (item: T, key: string) => void): Unsubscribe {
    (this.removeCbs ??= new Set()).add(cb);
    return () => {
      this.removeCbs?.delete(cb);
    };
  }

  set(key: string, value: T): this {
    const had = this.map.has(key);
    this.map.set(key, value);
    if (!had) {
      this._added.add(key);
      this._removed.delete(key);
      this.addCbs?.forEach((cb) => cb(value, key));
    }
    return this;
  }

  delete(key: string): boolean {
    const value = this.map.get(key);
    const had = this.map.delete(key);
    if (had) {
      // A key added AND removed within the same delta window nets to nothing (the
      // client never heard of it); one that existed before the window is a removal.
      if (this._added.has(key)) this._added.delete(key);
      else this._removed.add(key);
      this.removeCbs?.forEach((cb) => cb(value as T, key));
    }
    return had;
  }

  clear(): void {
    for (const key of [...this.map.keys()]) this.delete(key);
  }

  get(key: string): T | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  forEach(cb: (value: T, key: string, map: unknown) => void): void {
    this.map.forEach((v, k) => cb(v, k, this));
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  values(): IterableIterator<T> {
    return this.map.values();
  }

  /** Iterates [key, value] entries, like MapSchema. */
  [Symbol.iterator](): IterableIterator<[string, T]> {
    return this.map.entries();
  }

  /** Drain the keys added/removed since the last call (delta encoding). */
  consumeKeyDelta(): { added: string[]; removed: string[] } {
    const delta = { added: [...this._added], removed: [...this._removed] };
    this._added.clear();
    this._removed.clear();
    return delta;
  }
}
