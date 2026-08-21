/**
 * After one-shot L→R lock, keep person indices sticky by face (preferred) then position.
 */

export type FaceDescriptor = number[];

export type NumberingSlot = {
  index: number;
  trackId: number | null;
  x: number;
  y: number;
  /** Session face template captured at lock (or refreshed while visible). */
  faceDescriptor?: FaceDescriptor | null;
};

export type TrackPoint = {
  trackId: number;
  x: number;
  y: number;
  /** Optional live face descriptor for this track (same frame). */
  faceDescriptor?: FaceDescriptor | null;
};

export type RebindOptions = {
  /** Max normalized distance to claim an orphaned slot by position (default 0.35). */
  maxDistance?: number;
  /** Min cosine similarity to claim a slot by face (default 0.82). */
  minFaceSimilarity?: number;
};

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cosineSimilarity(a: FaceDescriptor, b: FaceDescriptor): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
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
      faceDescriptor: null,
    };
  });
}

/**
 * Re-associate locked slots with current tracks.
 * 1) Keep slot↔trackId if that track still exists.
 * 2) Face match: orphaned slots ↔ free tracks with high descriptor similarity.
 * 3) Position fallback: nearest unmatched track within maxDistance.
 * 4) Refresh slot centers; optionally refresh faceDescriptor from matched track.
 */
export function rebindSlotsToTracks(
  slots: readonly NumberingSlot[],
  tracks: readonly TrackPoint[],
  options: RebindOptions = {},
): NumberingSlot[] {
  const maxDistance = options.maxDistance ?? 0.35;
  const minFaceSimilarity = options.minFaceSimilarity ?? 0.82;
  const byId = new Map(tracks.map((t) => [t.trackId, t]));
  const usedTracks = new Set<number>();
  const next: NumberingSlot[] = slots.map((s) => ({ ...s }));

  // Pass 1: keep existing trackIds that are still alive.
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
    if (t.faceDescriptor && t.faceDescriptor.length) {
      slot.faceDescriptor = t.faceDescriptor;
    }
  }

  // Pass 2: face similarity for orphaned slots.
  type FacePair = { si: number; trackId: number; sim: number };
  const facePairs: FacePair[] = [];
  for (let si = 0; si < next.length; si++) {
    if (next[si].trackId != null) continue;
    const template = next[si].faceDescriptor;
    if (!template || !template.length) continue;
    for (const t of tracks) {
      if (usedTracks.has(t.trackId)) continue;
      if (!t.faceDescriptor || !t.faceDescriptor.length) continue;
      const sim = cosineSimilarity(template, t.faceDescriptor);
      if (sim >= minFaceSimilarity) {
        facePairs.push({ si, trackId: t.trackId, sim });
      }
    }
  }
  facePairs.sort((a, b) => b.sim - a.sim);
  for (const { si, trackId } of facePairs) {
    if (next[si].trackId != null) continue;
    if (usedTracks.has(trackId)) continue;
    const t = byId.get(trackId)!;
    next[si].trackId = trackId;
    next[si].x = t.x;
    next[si].y = t.y;
    if (t.faceDescriptor && t.faceDescriptor.length) {
      next[si].faceDescriptor = t.faceDescriptor;
    }
    usedTracks.add(trackId);
  }

  // Pass 3: fill remaining orphaned slots with nearest free tracks by position.
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
    if (t.faceDescriptor && t.faceDescriptor.length) {
      next[si].faceDescriptor = t.faceDescriptor;
    }
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

export function countSlotsWithFace(slots: readonly NumberingSlot[]): number {
  return slots.filter((s) => s.faceDescriptor && s.faceDescriptor.length > 0).length;
}
