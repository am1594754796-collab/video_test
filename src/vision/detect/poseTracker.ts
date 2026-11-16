/**
 * Lightweight multi-pose tracker: stabilize IDs across frames to reduce flicker.
 * Fast path for classroom scout: brief miss holds + sticky display numbers.
 */

import { torsoCenter, type PoseLike } from "./dedupePoses";
import type { PoseLandmark } from "./isHandRaised";
import { RaiseDebouncer } from "./raiseDebouncer";

export type TrackedPose = {
  trackId: number;
  /** 1-based left-to-right index for display. */
  displayIndex: number;
  landmarks: readonly PoseLandmark[];
  center: { x: number; y: number };
  debouncer: RaiseDebouncer;
  /** False when holding last pose through a missed detection frame. */
  fresh: boolean;
};

export type PoseTrackerOptions = {
  matchDistance?: number;
  /** Scale Δy in match distance (default 1). <1 prefers horizontal seat matching. */
  matchYWeight?: number;
  maxMissed?: number;
  minFrames?: number;
  /**
   * New tracks must be seen this many frames before they affect numbering.
   * Cuts one-frame false people that would reshuffle 1–N.
   */
  minSeen?: number;
  /**
   * When true (default), keep displayIndex for the same track-id set instead of
   * re-sorting every frame. Reassign left→right only when tracks enter/leave.
   */
  stickyDisplay?: boolean;
};

type InternalTrack = {
  id: number;
  center: { x: number; y: number };
  landmarks: readonly PoseLandmark[];
  missed: number;
  seen: number;
  debouncer: RaiseDebouncer;
};

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
  yWeight: number,
): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) * yWeight;
  return Math.hypot(dx, dy);
}

export class PoseTracker {
  private readonly matchDistance: number;
  private readonly matchYWeight: number;
  private readonly maxMissed: number;
  private readonly minSeen: number;
  private readonly stickyDisplay: boolean;
  private minFrames: number;
  private nextId = 1;
  private tracks: InternalTrack[] = [];
  private displayByTrack = new Map<number, number>();
  private lastActiveKey = "";

  constructor(options: PoseTrackerOptions = {}) {
    this.matchDistance = options.matchDistance ?? 0.18;
    this.matchYWeight = options.matchYWeight ?? 1;
    this.maxMissed = options.maxMissed ?? 10;
    this.minSeen = Math.max(1, options.minSeen ?? 1);
    this.stickyDisplay = options.stickyDisplay ?? true;
    this.minFrames = options.minFrames ?? 4;
  }

  setMinFrames(minFrames: number): void {
    this.minFrames = Math.max(1, minFrames);
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
    this.displayByTrack.clear();
    this.lastActiveKey = "";
  }

  update(poses: readonly PoseLike[]): TrackedPose[] {
    const detections = poses.map((p) => ({
      landmarks: p.landmarks,
      center: torsoCenter(p.landmarks),
    }));

    const usedDet = new Set<number>();
    const usedTrack = new Set<number>();

    // Greedy nearest-neighbor match.
    type Pair = { ti: number; di: number; d: number };
    const pairs: Pair[] = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      for (let di = 0; di < detections.length; di++) {
        pairs.push({
          ti,
          di,
          d: dist(this.tracks[ti]!.center, detections[di]!.center, this.matchYWeight),
        });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    for (const { ti, di, d } of pairs) {
      if (usedTrack.has(ti) || usedDet.has(di)) continue;
      if (d > this.matchDistance) continue;
      const track = this.tracks[ti]!;
      const det = detections[di]!;
      track.center = det.center;
      track.landmarks = det.landmarks;
      track.missed = 0;
      track.seen += 1;
      usedTrack.add(ti);
      usedDet.add(di);
    }

    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!usedTrack.has(ti)) this.tracks[ti]!.missed += 1;
    }

    for (let di = 0; di < detections.length; di++) {
      if (usedDet.has(di)) continue;
      const det = detections[di]!;
      this.tracks.push({
        id: this.nextId++,
        center: det.center,
        landmarks: det.landmarks,
        missed: 0,
        seen: 1,
        debouncer: new RaiseDebouncer({ minFrames: this.minFrames }),
      });
    }

    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);

    const active = this.tracks.filter((t) => t.seen >= this.minSeen);
    const ordered = [...active].sort((a, b) => a.center.x - b.center.x || a.id - b.id);
    const activeKey = ordered.map((t) => t.id).join(",");

    if (!this.stickyDisplay || activeKey !== this.lastActiveKey) {
      this.displayByTrack.clear();
      ordered.forEach((t, i) => this.displayByTrack.set(t.id, i + 1));
      this.lastActiveKey = activeKey;
    }

    return ordered.map((t) => ({
      trackId: t.id,
      displayIndex: this.displayByTrack.get(t.id) ?? 0,
      landmarks: t.landmarks,
      center: t.center,
      debouncer: t.debouncer,
      fresh: t.missed === 0,
    }));
  }
}
