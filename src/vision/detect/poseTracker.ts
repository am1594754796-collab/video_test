/**
 * Lightweight multi-pose tracker: stabilize IDs across frames to reduce flicker.
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
  maxMissed?: number;
  minFrames?: number;
};

type InternalTrack = {
  id: number;
  center: { x: number; y: number };
  landmarks: readonly PoseLandmark[];
  missed: number;
  debouncer: RaiseDebouncer;
};

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class PoseTracker {
  private readonly matchDistance: number;
  private readonly maxMissed: number;
  private minFrames: number;
  private nextId = 1;
  private tracks: InternalTrack[] = [];

  constructor(options: PoseTrackerOptions = {}) {
    this.matchDistance = options.matchDistance ?? 0.18;
    this.maxMissed = options.maxMissed ?? 10;
    this.minFrames = options.minFrames ?? 4;
  }

  setMinFrames(minFrames: number): void {
    this.minFrames = Math.max(1, minFrames);
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
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
        pairs.push({ ti, di, d: dist(this.tracks[ti].center, detections[di].center) });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    for (const { ti, di, d } of pairs) {
      if (usedTrack.has(ti) || usedDet.has(di)) continue;
      if (d > this.matchDistance) continue;
      const track = this.tracks[ti];
      const det = detections[di];
      track.center = det.center;
      track.landmarks = det.landmarks;
      track.missed = 0;
      usedTrack.add(ti);
      usedDet.add(di);
    }

    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!usedTrack.has(ti)) this.tracks[ti].missed += 1;
    }

    for (let di = 0; di < detections.length; di++) {
      if (usedDet.has(di)) continue;
      const det = detections[di];
      this.tracks.push({
        id: this.nextId++,
        center: det.center,
        landmarks: det.landmarks,
        missed: 0,
        debouncer: new RaiseDebouncer({ minFrames: this.minFrames }),
      });
    }

    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);

    return [...this.tracks]
      .sort((a, b) => a.center.x - b.center.x)
      .map((t, i) => ({
        trackId: t.id,
        displayIndex: i + 1,
        landmarks: t.landmarks,
        center: t.center,
        debouncer: t.debouncer,
        fresh: t.missed === 0,
      }));
  }
}
