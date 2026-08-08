/**
 * Temporal debounce for hand-raise: require consecutive frames before flipping.
 */

export type RaiseDebouncerOptions = {
  /** Consecutive frames required to enter or leave raised state. */
  minFrames?: number;
};

export class RaiseDebouncer {
  private readonly minFrames: number;
  private streak = 0;
  private streakValue = false;
  private _raised = false;

  constructor(options: RaiseDebouncerOptions = {}) {
    this.minFrames = Math.max(1, options.minFrames ?? 4);
  }

  get raised(): boolean {
    return this._raised;
  }

  /** Feed one frame's raw raised predicate; returns stable raised state. */
  update(rawRaised: boolean): boolean {
    if (rawRaised === this.streakValue) {
      this.streak += 1;
    } else {
      this.streakValue = rawRaised;
      this.streak = 1;
    }

    if (this.streak >= this.minFrames && this._raised !== this.streakValue) {
      this._raised = this.streakValue;
    }
    return this._raised;
  }

  reset(): void {
    this.streak = 0;
    this.streakValue = false;
    this._raised = false;
  }
}
