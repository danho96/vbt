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
    this.rising = []; // aligned samples since velocity last was <= 0
    this.risingStart = 0;
    this.confirmed = false;
  }

  push([rawPos, rawVel]) {
    this.positions.push(rawPos);
    if (this.positions.length <= VELOCITY_LAG_SAMPLES) return;
    const pos = this.positions.shift();
    const vel = rawVel;
    const i = this.index++;
    if (vel <= 0) {
      if (this.confirmed) this.finish();
      this.rising = [];
      this.confirmed = false;
      return;
    }
    if (this.rising.length === 0) this.risingStart = i;
    this.rising.push([pos, vel]);
    if (vel >= this.opts.startVelocity) this.confirmed = true;
  }

  finish() {
    const rep = repMetrics(this.rising, this.risingStart);
    if (rep.rom * 10 >= this.opts.minRom && rep.peakVelocity * 1000 >= this.opts.minPeakVelocity) {
      this.onRep(rep);
    }
  }
}

export const velocityLoss = (best, current) => (best > 0 ? (best - current) / best : 0);

/** Groups reps into sets by the gap between them, and tracks each set's best and velocity loss. */
export class Session {
  constructor(options = {}) {
    this.opts = { ...DEFAULT_DETECTION, ...options };
    this.sets = [];
    this.lastRepEnd = -Infinity;
    this.forceNewSet = false;
  }

  newSet() {
    this.forceNewSet = true;
  }

  get currentSet() {
    return this.sets[this.sets.length - 1];
  }

  /** @returns {{set: object, rep: Rep, isNewSet: boolean}} */
  addRep(rep) {
    const gap = rep.startTime - this.lastRepEnd;
    const isNewSet = this.forceNewSet || !this.currentSet || gap >= this.opts.setGapSeconds;
    if (isNewSet) {
      this.sets.push({ number: this.sets.length + 1, reps: [], startedAt: Date.now() });
      this.forceNewSet = false;
    }
    const set = this.currentSet;
    set.reps.push(rep);
    this.lastRepEnd = rep.startTime + rep.duration;
    return { set, rep, isNewSet };
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
