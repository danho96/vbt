import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../app/js/analysis.js';
import { zoneStatus, ringFraction, percentInZone } from '../app/js/zones.js';
import { workoutCsv } from '../app/js/history.js';
import { batteryPercent } from '../app/js/settings.js';

const rep = (meanVelocity, extra = {}) => ({ direction: 1, meanVelocity, peakVelocity: meanVelocity * 1.6, rom: 40, duration: 0.5, timeToPeak: 0.2, startTime: 0, ...extra });

test('each new set is stamped with what is being lifted at that moment', () => {
  let info = { exercise: 'Przysiad', load: 100 };
  const session = new Session({ newSetInfo: () => ({ ...info }) });
  session.addPhase(rep(0.8, { startTime: 0 }));
  info = { exercise: 'Przysiad', load: 110 };
  session.addPhase(rep(0.7, { startTime: 3 })); // same set: info read only when a set opens
  session.newSet();
  session.addPhase(rep(0.6, { startTime: 6 }));
  assert.deepEqual(session.sets.map((s) => [s.number, s.load, s.reps.length]), [[1, 100, 2], [2, 110, 1]]);
});

test('zone status, ring fill and share of reps in zone', () => {
  const zone = { min: 0.8, max: 1.2 };
  assert.equal(zoneStatus(zone, 0.79), 'below');
  assert.equal(zoneStatus(zone, 0.8), 'in');
  assert.equal(zoneStatus(zone, 1.25), 'above');
  assert.equal(zoneStatus(null, 1), null);
  assert.equal(ringFraction(zone, 0.96), 0.8); // render 1 from the coach: 0,96 m/s in 0,80–1,20 fills ~80%
  assert.equal(ringFraction(zone, 2), 1);
  assert.equal(percentInZone(zone, [rep(0.9), rep(0.7), rep(1.0), rep(1.3)]), 0.5);
});

test('CSV keeps user text from breaking columns', () => {
  const csv = workoutCsv({ date: '2026-10-31T10:00:00Z', comment: 'Tempo; "wolniej"', sets: [{ number: 1, exercise: 'Przysiad; tylny', load: 100, zone: null, reps: [rep(0.5)] }] }, 'Jan');
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /;"Przysiad; tylny";100;1;1;0,50;0,80;491;/);
  assert.equal(lines[2], '"Komentarz: Tempo; ""wolniej"""');
});

test('battery percentage from voltage', () => {
  assert.equal(batteryPercent(4.2), 100);
  assert.equal(batteryPercent(3.3), 0);
  assert.equal(batteryPercent(3.75), 53);
});
