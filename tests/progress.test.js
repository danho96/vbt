import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseSessions, mainLoad, exerciseLoads, trend, exerciseOverview, workoutByExercise, workoutMinutes } from '../app/js/progress.js';

const rep = (meanVelocity, peakVelocity = meanVelocity * 1.6) => ({ meanVelocity, peakVelocity });
const set = (exercise, load, ...means) => ({ exercise, load, reps: means.map((m) => rep(m)) });
// Newest first, like the stored history.
const workouts = [
  { id: 'c', date: '2026-10-30T10:00:00Z', sets: [set('Przysiad', 100, 0.8, 0.7), set('Przysiad', 120, 0.5), set('Wyciskanie leżąc', 60, 0.6)] },
  { id: 'b', date: '2026-10-20T10:00:00Z', sets: [set('Przysiad', 100, 0.75, 0.65)] },
  { id: 'a', date: '2026-10-10T10:00:00Z', sets: [set('Przysiad', 100, 0.7, 0.6), set('Martwy ciąg', 140, 0.5)] },
];

test('sessions of one exercise: oldest first, per-load filter, best / avg / peak', () => {
  const all = exerciseSessions(workouts, 'Przysiad');
  assert.deepEqual(all.map((s) => [s.workoutId, s.sets, s.reps]), [['a', 1, 2], ['b', 1, 2], ['c', 2, 3]]);
  const c = all[2];
  assert.equal(c.best, 0.8);
  assert.ok(Math.abs(c.avg - (0.8 + 0.7 + 0.5) / 3) < 1e-9);
  assert.equal(c.peak, 0.8 * 1.6);
  assert.deepEqual(c.loads, [100, 120]);
  assert.deepEqual(exerciseSessions(workouts, 'Przysiad', 120).map((s) => s.workoutId), ['c']);
});

test('main load is the most used one; loads are listed lightest first', () => {
  assert.equal(mainLoad(workouts, 'Przysiad'), 100);
  assert.equal(mainLoad([{ sets: [set('X', 0, 0.5)] }], 'X'), null);
  assert.equal(mainLoad([{ sets: [set('X', 50, 0.5), set('X', 60, 0.5)] }], 'X'), 60, 'tie goes to the heavier load');
  assert.deepEqual(exerciseLoads(workouts, 'Przysiad'), [100, 120]);
});

test('trend: fitted direction, consistency, and too little data', () => {
  const s = (...ys) => ys.map((best, i) => ({ best, date: `2026-10-${10 + i}` }));
  const up = trend(s(0.35, 0.38, 0.42, 0.41, 0.47, 0.5), 'best');
  assert.equal(up.status, 'up');
  assert.equal(up.consistent, true);
  assert.equal(up.best, 0.5);
  assert.ok(Math.abs(up.changePct - (0.5 - 0.35) / 0.35) < 1e-9);

  // A single great day at the end does not turn a flat history into progress.
  const flat = trend(s(0.5, 0.49, 0.51, 0.5, 0.5, 0.49, 0.5, 0.51, 0.55), 'best');
  assert.equal(flat.status, 'flat');

  const zigzag = trend(s(0.4, 0.5, 0.42, 0.52, 0.44, 0.55), 'best');
  assert.equal(zigzag.status, 'up');
  assert.equal(zigzag.consistent, false);

  assert.equal(trend(s(0.6, 0.5, 0.45), 'best').status, 'down');
  assert.equal(trend(s(0.5), 'best').status, null);
  assert.equal(trend([], 'best'), null);
});

test('overview: one card per exercise, trend at the main load, newest first', () => {
  const overview = exerciseOverview(workouts);
  assert.deepEqual(overview.map((o) => o.exercise), ['Przysiad', 'Wyciskanie leżąc', 'Martwy ciąg']);
  const squat = overview[0];
  assert.equal(squat.load, 100);
  assert.equal(squat.totalSessions, 3);
  assert.deepEqual(squat.sessions.map((s) => s.best), [0.7, 0.75, 0.8]);
  assert.equal(squat.trend.status, 'up');
});

test('one workout grouped by exercise, with duration', () => {
  const groups = workoutByExercise(workouts[0]);
  assert.deepEqual(groups.map((g) => [g.exercise, g.sets.length, g.reps]), [['Przysiad', 2, 3], ['Wyciskanie leżąc', 1, 1]]);
  assert.deepEqual(groups[0].loads, [100, 120]);
  const w = { date: '2026-10-30T11:15:00Z', sets: [{ startedAt: Date.parse('2026-10-30T10:00:00Z') }, { startedAt: Date.parse('2026-10-30T10:30:00Z') }] };
  assert.equal(workoutMinutes(w), 75);
  assert.equal(workoutMinutes({ date: w.date, sets: [{}] }), null);
});
