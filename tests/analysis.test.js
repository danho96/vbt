import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePacket, hexToDataView } from '../app/js/protocol.js';
import { RepDetector, Session, setSummary, velocityLoss } from '../app/js/analysis.js';

const recording = JSON.parse(readFileSync(new URL('../app/demo/recording.json', import.meta.url), 'utf8'));
const samples = recording.packets.flatMap((hex) => parsePacket(hexToDataView(hex)).samples);

function detect(stream) {
  const phases = [];
  const detector = new RepDetector((phase) => phases.push(phase));
  stream.forEach((s) => detector.push(s));
  return phases;
}

// Cable retracting into the sensor instead of being pulled out.
const mirrored = samples.map(([p, v]) => [-p, -v]);

function reps(stream, direction) {
  const session = new Session({ direction });
  detect(stream).forEach((phase) => session.addPhase(phase));
  session.closeSet();
  return session.sets.flatMap((s) => s.reps);
}

test('parses battery reply', () => {
  assert.deepEqual(parsePacket(hexToDataView('21007b01')), { type: 'battery', volts: 3.79 });
});

test('parses data packet into 20 [position, velocity] samples', () => {
  const packet = parsePacket(hexToDataView(recording.packets[3]));
  assert.equal(packet.type, 'samples');
  assert.equal(packet.samples.length, 20);
  assert.deepEqual(packet.samples[0], [57, 637]);
});

test('reference recording: 100 Hz stream, 14 phases each way', () => {
  assert.equal(samples.length, 122 * 20);
  const phases = detect(samples);
  assert.equal(phases.filter((p) => p.direction === 1).length, 14);
  assert.equal(phases.filter((p) => p.direction === -1).length, 14);
  for (const phase of phases) {
    assert.ok(phase.rom > 0);
    assert.ok(phase.peakVelocity >= phase.meanVelocity);
    assert.ok(phase.timeToPeak <= phase.duration);
  }
});

test('cable pulled out: concentric reps measured from rest to top', () => {
  const out = reps(samples, 'out');
  assert.equal(out.length, 14);
  // First rep travels from rest (~0 mm) to the top (~315 mm).
  assert.ok(Math.abs(out[0].rom - 32.3) < 0.5, `rom ${out[0].rom}`);
});

test('cable retracting: mirrored recording gives identical reps', () => {
  const inward = reps(mirrored, 'in');
  assert.deepEqual(inward.map((r) => r.meanVelocity), reps(samples, 'out').map((r) => r.meanVelocity));
  assert.ok(inward.every((r) => r.direction === -1 && r.rom > 0));
});

test('auto picks the clearly faster direction, either way round', () => {
  // Fast concentric (0.8 m/s), slow controlled eccentric (0.3 m/s), starting with the eccentric like a squat.
  const phase = (direction, meanVelocity, startTime) => ({ direction, meanVelocity, peakVelocity: meanVelocity * 1.5, rom: 40, duration: 0.5, timeToPeak: 0.2, startTime });
  for (const concentric of [1, -1]) {
    const session = new Session({ direction: 'auto' });
    const accepted = [];
    for (let i = 0; i < 4; i++) {
      accepted.push(...session.addPhase(phase(-concentric, 0.3, i * 2)));
      accepted.push(...session.addPhase(phase(concentric, 0.8 - i * 0.05, i * 2 + 1)));
    }
    assert.equal(accepted.length, 4);
    assert.ok(accepted.every(({ rep }) => rep.direction === concentric));
    // The first rep is shown as soon as both directions have been seen.
    assert.equal(session.sets[0].reps.length, 4);
  }
});

test('auto waits on ambiguous reps and still settles on the faster average', () => {
  const session = new Session({ direction: 'auto' });
  detect(samples).forEach((phase) => session.addPhase(phase));
  session.closeSet();
  const all = session.sets.flatMap((s) => s.reps);
  assert.ok(all.every((r) => r.direction === 1), 'pulling out is faster on the reference recording');
});

test('ignores stillness and tiny movements', () => {
  const still = Array.from({ length: 500 }, () => [-8, 0]);
  const wobble = Array.from({ length: 500 }, (_, i) => [i % 20 < 10 ? 0 : 20, i % 20 < 10 ? 200 : -200]);
  assert.equal(detect(still).length, 0);
  assert.equal(detect(wobble).length, 0);
});

test('session splits sets on long pauses and on demand', () => {
  const session = new Session({ setGapSeconds: 30 });
  const rep = (startTime, meanVelocity) => ({ direction: 1, startTime, duration: 0.5, meanVelocity, peakVelocity: meanVelocity * 1.6 });
  session.addPhase(rep(0, 0.9));
  session.addPhase(rep(3, 0.8));
  session.addPhase(rep(40, 0.85));
  session.newSet();
  session.addPhase(rep(42, 0.7));
  session.addPhase({ ...rep(43, 0.9), direction: -1 }); // eccentric: not a rep
  assert.deepEqual(session.sets.map((s) => s.reps.length), [2, 1, 1]);
  assert.ok(Math.abs(setSummary(session.sets[0]).velocityLoss - (0.9 - 0.8) / 0.9) < 1e-9);
});

test('velocity loss is zero without a reference', () => {
  assert.equal(velocityLoss(0, 0.5), 0);
});
