import { Observable, trackedKeysOf } from "./Observable";
import { ObservableMap } from "./ObservableMap";

/**
 * The P2P replication codec (Phase 5 foundation). The host encodes the change delta
 * on its authoritative state each snapshot; a guest applies it to its OWN copy of the
 * same state classes — so the guest's ObservableMap/Observable fire the exact
 * onAdd/onRemove/onChange the client already renders off, no bespoke reconstruction.
 *
 * It reuses the observable dirty-tracking: `consumeDirty()` per row (changed fields)
 * and `consumeKeyDelta()` per map (added/removed keys). Encoding DRAINS that state, so
 * call `encodeDelta` exactly once per snapshot. The wire form is plain JSON-able data
 * (numbers/strings/booleans), ready for a WebRTC data channel.
 *
 * Deliberately generic over the state tree — the one GameState-specific fact (which
 * class backs each map, so the guest can build a row) is the `MapSchema` descriptor,
 * the codec's single typed resolver.
 */
type FieldMap = Record<string, unknown>;

export interface MapDelta {
  /** New rows this window — full field snapshot each. */
  added: Record<string, FieldMap>;
  /** Existing rows — only the fields that changed. */
  changed: Record<string, FieldMap>;
  removed: string[];
}

export interface RootDelta {
  /** Root-level tracked scalar changes (gold, floor, phase, …). */
  scalars: FieldMap;
  maps: Record<string, MapDelta>;
}

/** Which Observable subclass backs each replicated map field on the root. */
export type MapSchema = Record<string, new () => Observable>;

function snapshotRow(row: Observable): FieldMap {
  const out: FieldMap = {};
  for (const k of trackedKeysOf(row)) out[k] = (row as unknown as FieldMap)[k];
  return out;
}

function dirtyRow(row: Observable): FieldMap {
  const out: FieldMap = {};
  const src = row as unknown as FieldMap;
  for (const k of row.consumeDirty()) out[k] = src[k];
  return out;
}

function assignFields(row: Observable, fields: FieldMap): void {
  const dst = row as unknown as FieldMap;
  for (const k of Object.keys(fields)) dst[k] = fields[k];
}

/** Encode `root`'s changes since the last call. Drains dirty state — call once per
 *  snapshot. Map container fields are handled as maps, not scalars. */
export function encodeDelta(root: Observable, maps: MapSchema): RootDelta {
  const scalars = dirtyRow(root);
  for (const field of Object.keys(maps)) delete scalars[field];

  const mapDeltas: Record<string, MapDelta> = {};
  for (const field of Object.keys(maps)) {
    const m = (root as unknown as Record<string, ObservableMap<Observable>>)[field];
    const { added, removed } = m.consumeKeyDelta();
    const addedSet = new Set(added);
    const addedRows: Record<string, FieldMap> = {};
    const changedRows: Record<string, FieldMap> = {};
    m.forEach((row, key) => {
      if (addedSet.has(key)) {
        addedRows[key] = snapshotRow(row);
        row.consumeDirty(); // fully sent — clear its dirty set
      } else if (row.isDirty) {
        changedRows[key] = dirtyRow(row);
      }
    });
    mapDeltas[field] = { added: addedRows, changed: changedRows, removed };
  }
  return { scalars, maps: mapDeltas };
}

/** Apply a delta to a guest's `root` (a real GameState). Reproduces onAdd/onRemove/
 *  onChange through the guest's own ObservableMap/Observable. */
export function applyDelta(root: Observable, maps: MapSchema, delta: RootDelta): void {
  assignFields(root, delta.scalars);
  for (const field of Object.keys(delta.maps)) {
    const m = (root as unknown as Record<string, ObservableMap<Observable>>)[field];
    const md = delta.maps[field];
    for (const key of md.removed) m.delete(key);
    for (const key of Object.keys(md.added)) {
      const row = new maps[field]();
      assignFields(row, md.added[key]);
      m.set(key, row);
    }
    for (const key of Object.keys(md.changed)) {
      const row = m.get(key);
      if (row) assignFields(row, md.changed[key]);
    }
  }
}
