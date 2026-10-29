// Turns the 100 Hz stream of [position mm, velocity mm/s] samples into reps and sets.
import { SAMPLE_RATE_HZ } from './protocol.js';

export const DEFAULT_DETECTION = {
  startVelocity: 100, // mm/s: velocity that confirms a concentric phase has started
  minRom: 50, // mm: shorter movements are ignored (bar wobble, re-racking)
  minPeakVelocity: 150, // mm/s
  setGapSeconds: 30, // stillness after which the next rep starts a new set
};

// The sensor's velocity channel is smoothed on-device and trails its position channel by ~50 ms
// (cross-correlation peak on the reference recording), so velocity sample i + LAG belongs to position sample i.
export const VELOCITY_LAG_SAMPLES = 5;

/**
 * Metrics of one concentric phase.
 * @typedef {{meanVelocity: number, peakVelocity: number, rom: number, duration: number,
 *            timeToPeak: number, startTime: number}} Rep
 * Velocities in m/s, rom in cm, durations/times in s.
 * Mean velocity is displacement / time (position is unfiltered); peak velocity comes from the smoothed
 * velocity channel, because differentiating position amplifies single-sample glitches.
 * @param {Array<[number, number]>} samples aligned [position mm, velocity mm/s] pairs
 */
export function repMetrics(samples, startIndex) {
  let peak = -Infinity;
  let peakAt = 0;
  samples.forEach(([, v], i) => {
    if (v > peak) {
      peak = v;
      peakAt = i;
    }
  });
  const dt = 1 / SAMPLE_RATE_HZ;
  const romMm = samples[samples.length - 1][0] - samples[0][0];
  const duration = samples.length * dt;
  return {
    meanVelocity: romMm / duration / 1000,
    peakVelocity: peak / 1000,
    rom: romMm / 10,
    duration,
    timeToPeak: (peakAt + 1) * dt,
    startTime: startIndex * dt,
  };
}

/** Streaming concentric-phase detector. Feed raw sensor samples in order; onRep fires once per accepted rep. */
export class RepDetector {
  constructor(onRep, options = {}) {
    this.onRep = onRep;
    this.opts = { ...DEFAULT_DETECTION, ...options };
    this.positions = []; // positions waiting for their (late) velocity sample
    this.index = 0; // absolute index of the aligned sample
    this.run = []; // aligned samples since velocity last changed sign
    this.runSign = 0;
    this.runStart = 0;
    this.confirmed = false;
  }

  push([rawPos, rawVel]) {
    this.positions.push(rawPos);
    if (this.positions.length <= VELOCITY_LAG_SAMPLES) return;
    const pos = this.positions.shift();
    const vel = rawVel;
    const i = this.index++;
    const sign = Math.sign(vel);
    if (sign !== this.runSign) {
      if (this.confirmed) this.finish();
      this.run = [];
      this.runSign = sign;
      this.runStart = i;
      this.confirmed = false;
    }
    if (sign === 0) return;
    // Mirror moves toward the sensor so every phase is measured as positive travel.
    this.run.push([pos * sign, vel * sign]);
    if (vel * sign >= this.opts.startVelocity) this.confirmed = true;
  }

  finish() {
    const rep = repMetrics(this.run, this.runStart);
    if (rep.rom * 10 >= this.opts.minRom && rep.peakVelocity * 1000 >= this.opts.minPeakVelocity) {
      rep.direction = this.runSign;
      this.onRep(rep);
    }
  }
}

export const velocityLoss = (best, current) => (best > 0 ? (best - current) / best : 0);

// Which way the concentric phase goes: cable pulled out of the sensor (+1), retracting into it (-1),
// or 'auto': per set, the faster of the two phases. VBT lifts are done with maximal intent on the way up
// and a controlled descent, so the concentric phase is usually the fast one. Fast, symmetric reps (on the
// reference recording the two directions differ by <20%) make that ambiguous, so auto waits for a clear
// difference or for AUTO_MAX_PHASES phases each way before deciding.
export const DIRECTION_OUT = 1;
export const DIRECTION_IN = -1;
const AUTO_CLEAR_RATIO = 1.2;
const AUTO_MAX_PHASES = 3;

/**
 * Turns movement phases into reps grouped into sets. A set ends after setGapSeconds without movement
 * or on newSet(). Feeding a phase (or closing a set) returns the reps accepted by that call, since in
 * auto mode the first reps of a set are only known once a phase in each direction has been seen.
 */
export class Session {
  constructor(options = {}) {
    this.opts = { direction: 'out', ...DEFAULT_DETECTION, ...options };
    this.sets = [];
    this.lastPhaseEnd = -Infinity;
    this.setDirection = null; // concentric direction of the set being performed
    this.pending = []; // auto mode: phases seen before the set's direction is known
    this.startNextSet = true; // the next accepted rep opens a new set
  }

  get currentSet() {
    return this.sets[this.sets.length - 1];
  }

  /** @returns {Array<{set: object, rep: Rep}>} */
  newSet() {
    const accepted = this.closeSet();
    this.startNextSet = true;
    return accepted;
  }

  /** Ends the current set, deciding its direction from whatever was seen if auto mode was still unsure. */
  closeSet() {
    const accepted = this.pending.length ? this.resolvePending() : [];
    this.setDirection = null;
    return accepted;
  }

  /** @returns {Array<{set: object, rep: Rep}>} */
  addPhase(phase) {
    const accepted = [];
    if (phase.startTime - this.lastPhaseEnd >= this.opts.setGapSeconds) accepted.push(...this.newSet());
    this.lastPhaseEnd = phase.startTime + phase.duration;

    const fixed = { out: DIRECTION_OUT, in: DIRECTION_IN }[this.opts.direction];
    this.setDirection ??= fixed ?? null;
    if (this.setDirection !== null) {
      if (phase.direction === this.setDirection) accepted.push(...this.accept([phase]));
      return accepted;
    }

    this.pending.push(phase);
    const out = this.pending.filter((p) => p.direction === DIRECTION_OUT);
    const inward = this.pending.filter((p) => p.direction === DIRECTION_IN);
    const avg = (phases) => phases.reduce((a, p) => a + p.meanVelocity, 0) / phases.length;
    if (out.length && inward.length) {
      const ratio = Math.max(avg(out), avg(inward)) / Math.min(avg(out), avg(inward));
      if (ratio < AUTO_CLEAR_RATIO && Math.min(out.length, inward.length) < AUTO_MAX_PHASES) return accepted;
      accepted.push(...this.resolvePending());
    }
    return accepted;
  }

  /** Auto mode: picks the faster direction (on average) among pending phases and accepts those as reps. */
  resolvePending() {
    const avg = (dir) => {
      const phases = this.pending.filter((p) => p.direction === dir);
      return phases.length ? phases.reduce((a, p) => a + p.meanVelocity, 0) / phases.length : 0;
    };
    this.setDirection = avg(DIRECTION_OUT) >= avg(DIRECTION_IN) ? DIRECTION_OUT : DIRECTION_IN;
    const accepted = this.accept(this.pending.filter((p) => p.direction === this.setDirection));
    this.pending = [];
    return accepted;
  }

  accept(reps) {
    return reps.map((rep) => {
      if (this.startNextSet) {
        this.sets.push({ number: this.sets.length + 1, reps: [], startedAt: Date.now() });
        this.startNextSet = false;
      }
      const set = this.currentSet;
      set.reps.push(rep);
      return { set, rep };
    });
  }
}

/** Summary of a set; velocity loss is relative to the set's fastest rep (by mean velocity). */
export function setSummary(set) {
  const means = set.reps.map((r) => r.meanVelocity);
  const best = Math.max(...means);
  const last = means[means.length - 1];
  return {
    reps: set.reps.length,
    bestMean: best,
    avgMean: means.reduce((a, b) => a + b, 0) / means.length,
    peak: Math.max(...set.reps.map((r) => r.peakVelocity)),
    velocityLoss: velocityLoss(best, last),
  };
}
