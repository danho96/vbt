import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePacket, hexToDataView } from '../app/js/protocol.js';
import { RepDetector, repMetrics, meanPower, peakPower } from '../app/js/analysis.js';
import { METRICS, RING_METRICS, loadSettings } from '../app/js/settings.js';
import { addAthlete, loadAthletes, saveWorkout, loadHistory, deleteWorkout, deleteAthlete, workoutsOf } from '../app/js/history.js';

const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  },
});
beforeEach(() => store.clear());

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('mean power is m * g * mean velocity', () => {
  close(meanPower({ meanVelocity: 0.96 }, 140), 140 * 9.81 * 0.96);
});

test('peak power at constant velocity has no inertia term', () => {
  const samples = Array.from({ length: 50 }, (_, i) => [i * 10, 1000]);
  close(repMetrics(samples, 0).peakPowerPerKg, 9.81);
});

test('peak power includes acceleration', () => {
  // Accelerating at 5 m/s^2 up to 1 m/s: 100 samples at 100 Hz would be 5 m/s per s.
  const samples = Array.from({ length: 21 }, (_, i) => [i, i * 50]);
  const { peakPowerPerKg } = repMetrics(samples, 0);
  // Near the end of the ramp v is ~0.85-1 m/s while a = 5 m/s^2 (the window narrows at the very end).
  assert.ok(peakPowerPerKg > 0.85 * (9.81 + 5) && peakPowerPerKg < 1 * (9.81 + 5.01), `${peakPowerPerKg}`);
});

test('a single glitched velocity sample cannot fake a power spike', () => {
  const smooth = Array.from({ length: 40 }, (_, i) => [i * 10, 1000]);
  const glitched = smooth.map((s, i) => (i === 20 ? [s[0], 900] : s));
  assert.ok(repMetrics(glitched, 0).peakPowerPerKg < 1 * (9.81 + 1.8));
});

test('peak power on the real recording is at least the gravity-only value', () => {
  const { packets } = JSON.parse(readFileSync(new URL('../app/demo/recording.json', import.meta.url), 'utf8'));
  const reps = [];
  const detector = new RepDetector((r) => reps.push(r));
  packets.forEach((h) => parsePacket(hexToDataView(h)).samples.forEach((s) => detector.push(s)));
  for (const r of reps) {
    assert.ok(r.peakPowerPerKg > 0);
    assert.ok(peakPower(r, 100) >= meanPower(r, 100));
    assert.ok(r.peakPowerPerKg < 60, `${r.peakPowerPerKg} W/kg is not humanly plausible`);
  }
});

test('reps saved before peak power existed fall back to g * peak velocity', () => {
  close(peakPower({ peakVelocity: 1 }, 100), 981);
});

test('power metrics need the load; every main value option is available', () => {
  const r = { meanVelocity: 0.5, peakVelocity: 1, peakPowerPerKg: 20, rom: 40 };
  assert.equal(METRICS.power.format(r, { load: 0 }), '–');
  assert.equal(METRICS.power.value(r, { load: 0 }), 0);
  assert.equal(METRICS.peakPower.value(r, { load: 100 }), 2000);
  assert.equal(METRICS.rom.format(r), '40');
  for (const key of Object.keys(RING_METRICS)) assert.ok(key === 'zonePercent' || METRICS[key], key);
  for (const key of ['meanVelocity', 'peakVelocity', 'power', 'peakPower', 'rom']) assert.ok(RING_METRICS[key], key);
});

test('old settings keep a valid main value', () => {
  store.set('vbt.settings.v1', JSON.stringify({ ringMetric: 'zonePercent' }));
  assert.equal(loadSettings().ringMetric, 'zonePercent');
});

const workout = (athleteId) => saveWorkout({ athleteId, sets: [{ number: 1, reps: [{ meanVelocity: 0.5 }] }] });

test('deleting one workout leaves the others', () => {
  const a = addAthlete('Anna');
  const first = workout(a.id);
  const second = workout(a.id);
  deleteWorkout(first.id);
  assert.deepEqual(loadHistory().map((w) => w.id), [second.id]);
  assert.equal(loadAthletes().length, 1);
});

test('deleting an athlete removes only their workouts', () => {
  const a = addAthlete('Anna');
  const b = addAthlete('Basia');
  workout(a.id);
  const kept = workout(b.id);
  const unassigned = workout(null);
  deleteAthlete(a.id);
  assert.deepEqual(loadAthletes().map((x) => x.name), ['Basia']);
  assert.deepEqual(loadHistory().map((w) => w.id).sort(), [kept.id, unassigned.id].sort());
});

test('deleting the "no athlete" group removes its workouts and no athlete', () => {
  const a = addAthlete('Anna');
  const kept = workout(a.id);
  workout(null);
  deleteAthlete(null);
  assert.deepEqual(workoutsOf(null), []);
  assert.deepEqual(loadHistory().map((w) => w.id), [kept.id]);
  assert.equal(loadAthletes().length, 1);
});
