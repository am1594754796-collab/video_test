/**
 * IoU tracker: person boxes get stable ids across frames.
 */

import { boxCenter, boxIou, type PersonBox } from "./personBox";

export type BoxTrackerOptions = {
  minIou?: number;
  maxMissed?: number;
};

type Internal = {
  box: PersonBox;
  missed: number;
};

export type TrackedBox = PersonBox & { trackId: number; fresh: boolean };

export class BoxTracker {
  private readonly minIou: number;
  private readonly maxMissed: number;
  private nextId = 1;
  private tracks: Internal[] = [];

  constructor(options: BoxTrackerOptions = {}) {
    this.minIou = options.minIou ?? 0.25;
    this.maxMissed = options.maxMissed ?? 10;
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }

  update(detections: readonly PersonBox[]): TrackedBox[] {
    const usedDet = new Set<number>();
    const usedTrack = new Set<number>();

    type Pair = { ti: number; di: number; iou: number };
    const pairs: Pair[] = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      for (let di = 0; di < detections.length; di++) {
        pairs.push({
          ti,
          di,
          iou: boxIou(this.tracks[ti]!.box, detections[di]!),
        });
      }
    }
    pairs.sort((a, b) => b.iou - a.iou);

    for (const { ti, di, iou } of pairs) {
      if (usedTrack.has(ti) || usedDet.has(di)) continue;
      if (iou < this.minIou) continue;
      const track = this.tracks[ti]!;
      const det = detections[di]!;
      track.box = { ...det, trackId: track.box.trackId };
      track.missed = 0;
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
        box: { ...det, trackId: this.nextId++ },
        missed: 0,
      });
    }

    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);

    return [...this.tracks]
      .sort((a, b) => boxCenter(a.box).x - boxCenter(b.box).x)
      .map((t) => ({
        ...t.box,
        trackId: t.box.trackId!,
        fresh: t.missed === 0,
      }));
  }
}
