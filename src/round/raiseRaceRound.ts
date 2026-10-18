/**
 * Raise race round: countdown / open / locked.
 * Vision only reports raise edges; this module decides early vs winner.
 */

export type RoundPhase = "idle" | "countdown" | "open" | "locked";

export type RaiseRaceWinner = {
  personIndex: number;
  raisedAtMs: number;
};

export type RaiseRaceObservation = {
  personIndex: number;
  raised: boolean;
  /** Rising-edge capture time when available. */
  edgeAtMs?: number;
  score?: number;
};

export type RaiseRaceOutEvent =
  | { type: "early-raise"; personIndex: number; atMs: number }
  | { type: "winner"; personIndex: number; atMs: number };

export type RaiseRaceRoundOptions = {
  /**
   * Treat raises with captureTs < openTimestamp + grace as early.
   * Softens detector/audio latency at the open boundary. Default 80ms.
   */
  openGraceMs?: number;
};

export class RaiseRaceRound {
  private _phase: RoundPhase = "idle";
  private _openTimestampMs: number | null = null;
  private _winner: RaiseRaceWinner | null = null;
  private readonly early = new Set<number>();
  private prevRaised = new Map<number, boolean>();
  private priming = true;
  private readonly openGraceMs: number;

  constructor(options: RaiseRaceRoundOptions = {}) {
    this.openGraceMs = options.openGraceMs ?? 80;
  }

  get phase(): RoundPhase {
    return this._phase;
  }

  get openTimestampMs(): number | null {
    return this._openTimestampMs;
  }

  get winner(): RaiseRaceWinner | null {
    return this._winner;
  }

  get earlyViolations(): ReadonlySet<number> {
    return this.early;
  }

  /** Speech starts 3-2-1 audio. */
  beginCountdown(_nowMs?: number): void {
    this.clearOutcome();
    this._phase = "countdown";
    this._openTimestampMs = null;
    this.priming = true;
    this.prevRaised.clear();
  }

  /**
   * Audio ended (or bus open signal arrived). Stamp open time in the
   * same clock domain as capture timestamps (usually performance.now()).
   */
  openWindow(openTimestampMs: number): void {
    if (this._phase === "locked") return;
    this._openTimestampMs = openTimestampMs;
    this._phase = "open";
  }

  /** Vision-only / 「下一轮」: race immediately with no early window. */
  beginOpenNow(nowMs: number): void {
    this.clearOutcome();
    this._phase = "open";
    this._openTimestampMs = nowMs;
    this.priming = true;
    this.prevRaised.clear();
  }

  resetToIdle(): void {
    this._phase = "idle";
    this._openTimestampMs = null;
    this.clearOutcome();
    this.priming = true;
    this.prevRaised.clear();
  }

  /**
   * Feed one frame. `captureMs` is the frame clock; prefer observation.edgeAtMs
   * for rising edges when comparing to openTimestamp.
   */
  feed(people: readonly RaiseRaceObservation[], captureMs: number): RaiseRaceOutEvent[] {
    if (this._phase === "idle" || this._phase === "locked") {
      for (const p of people) this.prevRaised.set(p.personIndex, p.raised);
      this.priming = false;
      return [];
    }

    // First armed frame: treat "already raised" as a rising edge so a hand
    // held up into countdown/open still counts (demo-friendly).
    if (this.priming) {
      this.prevRaised.clear();
      for (const p of people) this.prevRaised.set(p.personIndex, false);
      this.priming = false;
    }

    type Cand = { personIndex: number; atMs: number; score: number };
    const rising: Cand[] = [];
    for (const p of people) {
      const was = this.prevRaised.get(p.personIndex) ?? false;
      if (p.raised && !was) {
        rising.push({
          personIndex: p.personIndex,
          atMs: p.edgeAtMs ?? captureMs,
          score: p.score ?? 0,
        });
      }
      this.prevRaised.set(p.personIndex, p.raised);
    }

    if (rising.length === 0) return [];

    rising.sort((a, b) => {
      if (a.atMs !== b.atMs) return a.atMs - b.atMs;
      return b.score - a.score;
    });

    if (this._phase === "countdown") {
      return this.recordEarly(rising);
    }

    // OPEN: split by effective open time.
    const openAt = (this._openTimestampMs ?? captureMs) + this.openGraceMs;
    const earlyCands = rising.filter((c) => c.atMs < openAt);
    const validCands = rising.filter((c) => c.atMs >= openAt);
    const out: RaiseRaceOutEvent[] = this.recordEarly(earlyCands);

    if (validCands.length === 0) return out;
    const best = validCands[0]!;
    this._winner = { personIndex: best.personIndex, raisedAtMs: best.atMs };
    this._phase = "locked";
    out.push({ type: "winner", personIndex: best.personIndex, atMs: best.atMs });
    return out;
  }

  private recordEarly(cands: readonly { personIndex: number; atMs: number }[]): RaiseRaceOutEvent[] {
    const out: RaiseRaceOutEvent[] = [];
    for (const c of cands) {
      if (this.early.has(c.personIndex)) continue;
      this.early.add(c.personIndex);
      out.push({ type: "early-raise", personIndex: c.personIndex, atMs: c.atMs });
    }
    return out;
  }

  private clearOutcome(): void {
    this._winner = null;
    this.early.clear();
  }
}
