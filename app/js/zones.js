// Velocity zones: a target range of mean velocity for a set. One zone can be active at a time.

export const PRESET_ZONES = [
  { id: 'power', name: 'Moc', description: 'Przyspieszanie ciężaru z maksymalną prędkością', min: 0.8, max: 1.2, icon: 'bolt' },
  { id: 'hypertrophy', name: 'Hipertrofia', description: 'Rozbudowa mięśni (5–10 powt.)', min: 0.5, max: 0.75, icon: 'muscle' },
  { id: 'strength', name: 'Siła', description: 'Maksymalny wysiłek (1–5 powt.)', min: 0.15, max: 0.3, icon: 'barbell' },
];

export const SLIDER_MAX = 1.5; // m/s; the editor's right end means "1.50 and above"

/** @returns {'below' | 'in' | 'above' | null} where a velocity lands relative to the zone */
export function zoneStatus(zone, velocity) {
  if (!zone) return null;
  if (velocity < zone.min) return 'below';
  if (velocity > zone.max) return 'above';
  return 'in';
}

/** Fraction of the ring to fill: how much of the zone's top speed the value reached. */
export function ringFraction(zone, velocity) {
  const top = zone ? zone.max : SLIDER_MAX;
  return Math.max(0, Math.min(1, velocity / top));
}

export function percentInZone(zone, reps) {
  if (!zone || !reps.length) return 0;
  return reps.filter((r) => zoneStatus(zone, r.meanVelocity) === 'in').length / reps.length;
}

export const formatRange = (zone, fmt) => `${fmt(zone.min, 2)} – ${fmt(zone.max, 2)}${zone.max >= SLIDER_MAX ? '+' : ''} m/s`;
