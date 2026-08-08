/**
 * First-raise race: after reset, first stable rising-edge raised wins until reset again.
 */

export type FirstRaiseEvent = {
  personIndex: number;
  raisedAtMs: number;
};

export type RaiseObservation = {
  personIndex: number;
  raised: boolean;
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

    const rising: number[] = [];
    for (const p of people) {
      const was = this.prevRaised.get(p.personIndex) ?? false;
      if (p.raised && !was) {
        rising.push(p.personIndex);
      }
      this.prevRaised.set(p.personIndex, p.raised);
    }

    if (rising.length === 0) return null;

    rising.sort((a, b) => a - b);
    this._winner = { personIndex: rising[0], raisedAtMs: nowMs };
    return this._winner;
  }
}
