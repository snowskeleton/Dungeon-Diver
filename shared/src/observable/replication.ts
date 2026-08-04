import { Observable, RowCtor, Schema, schemaOf } from "./Observable";
import { ObservableList } from "./ObservableList";
import { ObservableMap } from "./ObservableMap";

/**
 * The P2P replication codec. The host encodes the change delta on its authoritative
 * state each tick; a guest applies it to its OWN copy of the same state classes — so
 * the guest's ObservableMap/Observable/ObservableList fire the exact onAdd/onRemove/
 * onChange the client already renders off, no bespoke reconstruction.
 *
 * The state tree NESTS: GameState holds maps of rows (players/enemies/…), a PlayerState
 * holds ObservableLists of WeaponSlotState/UpgradeSlotState rows, an OfferChoiceState
 * holds a single nested WeaponSlotState, and several rows hold scalar lists. The codec
 * walks that whole tree generically, driven entirely by each field's `FieldSpec` — the
 * spec `@tracked(...)` already captures from its argument (`{ map: PlayerState }`,
 * `[WeaponSlotState]`, `["string"]`, `WeaponSlotState`). There is NO hand-written
 * GameState schema and no per-row adapter: the annotations ARE the schema.
 *
 * Two entry points, same wire shape (so `applyDelta` handles both):
 *  - `encodeDelta(root)`  — per tick. Sends only what changed and DRAINS dirty state,
 *    so call it exactly once per tick; broadcast the result to every guest.
 *  - `encodeSnapshot(root)` — for a guest that just connected. Sends EVERYTHING and
 *    drains NOTHING, so it can be taken at any time without disturbing the per-tick
 *    delta stream the already-connected guests share.
 *
 * The wire form is plain JSON-able data (numbers/strings/booleans/arrays/objects),
 * ready for a WebRTC data channel.
 */

/** A row encoded for the wire: field name → encoded value. The value's shape depends
 *  on the field's kind — scalar→primitive, scalarList→primitive[], row→Encoded|null,
 *  rowList→Encoded[], map→MapDelta. In a delta only changed fields are present; in a
 *  snapshot every field is. */
export type Encoded = Record<string, unknown>;

export interface MapDelta {
  /** New rows this window — each a FULL row snapshot. */
  added: Record<string, Encoded>;
  /** Existing rows — each only the fields that changed (may itself nest deltas). */
  changed: Record<string, Encoded>;
  removed: string[];
}

// ── Encode ──────────────────────────────────────────────────────────────────────

/** Does this row (or anything nested under it) have an unsent change? Non-draining —
 *  a pure predicate the map encoder uses to decide changed-vs-untouched. */
function rowIsDirty(row: Observable): boolean {
  if (row.isDirty) return true;
  for (const [field, spec] of schemaOf(row)) {
    const val = (row as unknown as Record<string, unknown>)[field];
    switch (spec.kind) {
      case "scalarList":
        if ((val as ObservableList<unknown>).isDirty) return true;
        break;
      case "row":
        if (rowIsDirty(val as Observable)) return true;
        break;
      case "rowList": {
        const list = val as ObservableList<Observable>;
        if (list.isDirty || list.some(rowIsDirty)) return true;
        break;
      }
      // A nested row never holds a map (only the root does), so "map" can't occur here.
      case "scalar":
      case "map":
        break;
    }
  }
  return false;
}

/** Encode one row. `full` sends every field (else only dirty ones); `drain` consumes
 *  dirty state (a snapshot passes `drain:false` so it doesn't disturb the delta stream). */
function encodeRow(row: Observable, full: boolean, drain: boolean): Encoded {
  const out: Encoded = {};
  const src = row as unknown as Record<string, unknown>;
  const dirtyScalars = drain ? row.consumeDirty() : undefined;
  for (const [field, spec] of schemaOf(row)) {
    switch (spec.kind) {
      case "scalar":
        if (full || dirtyScalars?.has(field)) out[field] = src[field];
        break;
      case "scalarList": {
        const list = src[field] as ObservableList<unknown>;
        const dirty = drain ? list.consumeDirty() : list.isDirty;
        if (full || dirty) out[field] = [...list];
        break;
      }
      case "row": {
        const sub = src[field] as Observable;
        if (full) out[field] = encodeRow(sub, true, drain);
        else if (rowIsDirty(sub)) out[field] = encodeRow(sub, false, drain);
        break;
      }
      case "rowList": {
        const list = src[field] as ObservableList<Observable>;
        const structDirty = drain ? list.consumeDirty() : list.isDirty;
        const dirty = structDirty || list.some(rowIsDirty);
        // Lists are short and re-encoded whole (each element FULL) whenever anything in
        // them moved — so the guest can rebuild them without per-index bookkeeping.
        if (full || dirty) out[field] = list.map((e) => encodeRow(e, true, drain));
        break;
      }
      case "map":
        out[field] = encodeMap(src[field] as ObservableMap<Observable>, full, drain);
        break;
    }
  }
  return out;
}

function encodeMap(m: ObservableMap<Observable>, full: boolean, drain: boolean): MapDelta {
  const { added, removed } = drain
    ? m.consumeKeyDelta()
    : { added: [] as string[], removed: [] as string[] };
  const addedSet = new Set(added);
  const addedRows: Record<string, Encoded> = {};
  const changedRows: Record<string, Encoded> = {};
  m.forEach((row, key) => {
    if (full || addedSet.has(key)) {
      // A brand-new (or full-snapshot) row: send the whole thing.
      addedRows[key] = encodeRow(row, true, drain);
    } else if (rowIsDirty(row)) {
      changedRows[key] = encodeRow(row, false, drain);
    }
  });
  return { added: addedRows, changed: changedRows, removed };
}

/** Encode `root`'s changes since the last call. DRAINS dirty state — call once per
 *  tick, then broadcast the result to every guest. */
export function encodeDelta(root: Observable): Encoded {
  return encodeRow(root, false, true);
}

/** Encode the FULL current state of `root`, draining nothing. Send this to a guest the
 *  moment it connects, then feed it the ongoing per-tick `encodeDelta` broadcast. */
export function encodeSnapshot(root: Observable): Encoded {
  return encodeRow(root, true, false);
}

// ── Apply ───────────────────────────────────────────────────────────────────────

/** Apply an encoded row (delta OR full snapshot — same shape) to a guest's live row,
 *  driving its onChange/onAdd/onRemove exactly as a local mutation would. */
function applyRow(row: Observable, enc: Encoded): void {
  const schema: Schema = schemaOf(row);
  const dst = row as unknown as Record<string, unknown>;
  for (const field of Object.keys(enc)) {
    const spec = schema.get(field);
    if (!spec) continue; // unknown field (version skew) — ignore rather than crash
    const val = enc[field];
    switch (spec.kind) {
      case "scalar":
        dst[field] = val; // proxy set-trap fires the row's onChange
        break;
      case "scalarList":
        applyScalarList(dst[field] as ObservableList<unknown>, val as unknown[]);
        break;
      case "row":
        applyRow(dst[field] as Observable, val as Encoded);
        break;
      case "rowList":
        applyRowList(dst[field] as ObservableList<Observable>, val as Encoded[], spec.ctor);
        break;
      case "map":
        applyMap(dst[field] as ObservableMap<Observable>, val as MapDelta, spec.ctor);
        break;
    }
  }
}

/** Reconcile a scalar list. Grows by push (firing onAdd, which the offer picker's
 *  consumed/claimedBy refresh relies on) when the incoming array extends the current
 *  one; otherwise rebuilds wholesale (shrink or per-floor reset). */
function applyScalarList(list: ObservableList<unknown>, arr: unknown[]): void {
  const isPrefix = arr.length >= list.length && list.every((v, i) => v === arr[i]);
  if (isPrefix) {
    for (let i = list.length; i < arr.length; i++) list.push(arr[i]);
  } else {
    list.splice(0, list.length);
    for (const v of arr) list.push(v);
  }
}

/** Reconcile a list of nested rows by index: existing rows are updated in place (so
 *  their onChange fires), surplus rows are dropped, new rows are constructed and pushed
 *  (firing the list's onAdd). */
function applyRowList(list: ObservableList<Observable>, arr: Encoded[], ctor: RowCtor): void {
  while (list.length > arr.length) list.splice(list.length - 1, 1);
  for (let i = 0; i < arr.length; i++) {
    if (i < list.length) {
      applyRow(list[i], arr[i]);
    } else {
      const row = new ctor();
      applyRow(row, arr[i]);
      list.push(row);
    }
  }
}

function applyMap(m: ObservableMap<Observable>, delta: MapDelta, ctor: RowCtor): void {
  for (const key of delta.removed) m.delete(key);
  for (const key of Object.keys(delta.added)) {
    // A key can arrive as "added" for one who already has it: a guest that took a
    // snapshot then joined the shared delta stream re-sees the pre-snapshot adds. So
    // merge into the existing row (preserving its identity + onChange subscriptions)
    // rather than replacing it; only a genuinely new key constructs a row + fires onAdd.
    const existing = m.get(key);
    if (existing) {
      applyRow(existing, delta.added[key]);
    } else {
      const row = new ctor();
      applyRow(row, delta.added[key]);
      m.set(key, row); // fires onAdd
    }
  }
  for (const key of Object.keys(delta.changed)) {
    const row = m.get(key);
    if (row) applyRow(row, delta.changed[key]); // fires onChange
  }
}

/** Apply a delta or snapshot to a guest's `root` (a real GameState). */
export function applyDelta(root: Observable, enc: Encoded): void {
  applyRow(root, enc);
}
