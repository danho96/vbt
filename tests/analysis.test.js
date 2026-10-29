import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePacket, hexToDataView } from '../app/js/protocol.js';
import { RepDetector, Session, setSummary, velocityLoss } from '../app/js/analysis.js';

const recording = JSON.parse(readFileSync(new URL('../app/demo/recording.json', import.meta.url), 'utf8'));
const samples = recording.packets.flatMap((hex) => parsePacket(hexToDataView(hex)).samples);

function detect(stream) {
  const reps = [];
  const detector = new RepDetector((rep) => reps.push(rep));
  stream.forEach((s) => detector.push(s));
  return reps;
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

test('reference recording: 100 Hz stream with 14 concentric phases', () => {
  assert.equal(samples.length, 122 * 20);
  const reps = detect(samples);
  assert.equal(reps.length, 14);
  // First rep travels from rest (~0 mm) to the top (~315 mm).
  assert.ok(Math.abs(reps[0].rom - 32.3) < 0.5, `rom ${reps[0].rom}`);
  for (const rep of reps) {
    assert.ok(rep.peakVelocity >= rep.meanVelocity);
    assert.ok(rep.timeToPeak <= rep.duration);
  }
});

test('ignores stillness and tiny movements', () => {
  const still = Array.from({ length: 500 }, () => [-8, 0]);
  const wobble = Array.from({ length: 500 }, (_, i) => [i % 20 < 10 ? 0 : 20, i % 20 < 10 ? 200 : -200]);
  assert.equal(detect(still).length, 0);
  assert.equal(detect(wobble).length, 0);
});

test('session splits sets on long pauses and on demand', () => {
  const session = new Session({ setGapSeconds: 30 });
  const rep = (startTime, meanVelocity) => ({ startTime, duration: 0.5, meanVelocity, peakVelocity: meanVelocity * 1.6 });
  session.addRep(rep(0, 0.9));
  session.addRep(rep(3, 0.8));
  assert.equal(session.addRep(rep(40, 0.85)).isNewSet, true);
  session.newSet();
  assert.equal(session.addRep(rep(42, 0.7)).isNewSet, true);
  assert.equal(session.sets.length, 3);
  assert.ok(Math.abs(setSummary(session.sets[0]).velocityLoss - (0.9 - 0.8) / 0.9) < 1e-9);
});

test('velocity loss is zero without a reference', () => {
  assert.equal(velocityLoss(0, 0.5), 0);
});
