/**
 * First-raise race: after reset, earliest rising edge wins until reset again.
 * Same-frame ties prefer earlier edgeAtMs, then higher raise score.
 * Never prefers lower personIndex.
 */

export type FirstRaiseEvent = {
  personIndex: number;
  raisedAtMs: number;
};

export type RaiseObservation = {
  personIndex: number;
  raised: boolean;
  /** Continuous raise strength; higher wins same-frame ties when edge times match. */
  score?: number;
  /** Interpolated rising-edge time (ms). Prefer over nowMs when present. */
  edgeAtMs?: number;
};

export class FirstRaiseTracker {
  private _winner: FirstRaiseEvent | null = null;
  private armed = true;
  private prevRaised = new Map<number, boolean>();
  /** After construct/reset, first update only seeds prevRaised (no award). */
  private priming = true;

  get winner(): FirstRaiseEvent | null {
    return this._winner;
  }

  setArmed(armed: boolean): void {
    this.armed = armed;
  }

  reset(): void {
    this._winner = null;
    this.prevRaised.clear();
    this.priming = true;
  }

  /**
   * Feed one frame of per-person raised flags.
   * Returns the winner event when first awarded this cycle; otherwise current winner or null.
   */
  update(people: readonly RaiseObservation[], nowMs: number): FirstRaiseEvent | null {
    if (this.priming) {
      this.prevRaised.clear();
      for (const p of people) {
        this.prevRaised.set(p.personIndex, p.raised);
      }
      this.priming = false;
      return this._winner;
    }

    if (!this.armed || this._winner) {
      for (const p of people) {
        this.prevRaised.set(p.personIndex, p.raised);
      }
      return this._winner;
    }

    type Cand = { personIndex: number; edgeAtMs: number; score: number };
    const rising: Cand[] = [];
    for (const p of people) {
      const was = this.prevRaised.get(p.personIndex) ?? false;
      if (p.raised && !was) {
        rising.push({
          personIndex: p.personIndex,
          edgeAtMs: p.edgeAtMs ?? nowMs,
          score: p.score ?? 0,
        });
      }
      this.prevRaised.set(p.personIndex, p.raised);
    }

    if (rising.length === 0) return null;

    // Time first, then raise strength — never seat number.
    rising.sort((a, b) => {
      if (a.edgeAtMs !== b.edgeAtMs) return a.edgeAtMs - b.edgeAtMs;
      return b.score - a.score;
    });
    const best = rising[0]!;
    this._winner = { personIndex: best.personIndex, raisedAtMs: best.edgeAtMs };
    return this._winner;
  }
}
