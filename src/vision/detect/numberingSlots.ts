/**
 * After one-shot L→R lock, keep person indices sticky by position.
 */

export type NumberingSlot = {
  index: number;
  trackId: number | null;
  x: number;
  y: number;
};

export type TrackPoint = {
  trackId: number;
  x: number;
  y: number;
};

export type RebindOptions = {
  /** Max normalized distance to claim an orphaned slot by position (default 0.35). */
  maxDistance?: number;
};

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function slotsFromSort(
  people: readonly { index: number; id?: string | number | null; x: number; y: number }[],
): NumberingSlot[] {
  return people.map((p) => {
    const id = typeof p.id === "number" ? p.id : Number(p.id);
    return {
      index: p.index,
      trackId: Number.isFinite(id) ? id : null,
      x: p.x,
      y: p.y,
    };
  });
}

/**
 * Re-associate locked slots with current tracks.
 * 1) Keep slot↔trackId if that track still exists.
 * 2) Position fallback: nearest unmatched track within maxDistance.
 * 3) Refresh slot centers from the matched track.
 */
export function rebindSlotsToTracks(
  slots: readonly NumberingSlot[],
  tracks: readonly TrackPoint[],
  options: RebindOptions = {},
): NumberingSlot[] {
  const maxDistance = options.maxDistance ?? 0.35;
  const byId = new Map(tracks.map((t) => [t.trackId, t]));
  const usedTracks = new Set<number>();
  const next: NumberingSlot[] = slots.map((s) => ({ ...s }));

  for (const slot of next) {
    if (slot.trackId == null) continue;
    const t = byId.get(slot.trackId);
    if (!t) {
      slot.trackId = null;
      continue;
    }
    usedTracks.add(t.trackId);
    slot.x = t.x;
    slot.y = t.y;
  }

  type Pair = { si: number; trackId: number; d: number };
  const pairs: Pair[] = [];
  for (let si = 0; si < next.length; si++) {
    if (next[si].trackId != null) continue;
    for (const t of tracks) {
      if (usedTracks.has(t.trackId)) continue;
      pairs.push({ si, trackId: t.trackId, d: dist(next[si], t) });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  for (const { si, trackId, d } of pairs) {
    if (next[si].trackId != null) continue;
    if (usedTracks.has(trackId)) continue;
    if (d > maxDistance) continue;
    const t = byId.get(trackId)!;
    next[si].trackId = trackId;
    next[si].x = t.x;
    next[si].y = t.y;
    usedTracks.add(trackId);
  }

  return next;
}

export function indexByTrackIdFromSlots(slots: readonly NumberingSlot[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const s of slots) {
    if (s.trackId != null) map.set(s.trackId, s.index);
  }
  return map;
}
