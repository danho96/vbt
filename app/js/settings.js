// User preferences, kept per device in localStorage.
import { meanPower, peakPower } from './analysis.js';

/** Metric of a power kind: value is 0 and the text a dash until the load is set. */
const powerMetric = (label, short, compute) => ({
  label, short, unit: 'W', icon: 'bolt', needsLoad: true,
  value: (r, set) => (set?.load > 0 ? compute(r, set.load) : 0),
  format: (r, set) => (set?.load > 0 ? fmt(compute(r, set.load), 0) : '–'),
});

export const METRICS = {
  meanVelocity: { label: 'Prędkość średnia', short: 'Średnia', unit: 'm/s', icon: 'speed', value: (r) => r.meanVelocity, format: (r) => fmt(r.meanVelocity, 2) },
  peakVelocity: { label: 'Prędkość max', short: 'Max', unit: 'm/s', icon: 'gauge', value: (r) => r.peakVelocity, format: (r) => fmt(r.peakVelocity, 2) },
  power: powerMetric('Moc średnia', 'Moc', meanPower),
  peakPower: powerMetric('Moc max', 'Moc max', peakPower),
  rom: { label: 'Odległość', short: 'Odległość', unit: 'cm', icon: 'ruler', value: (r) => r.rom, format: (r) => fmt(r.rom, 0) },
  velocityLoss: { label: 'Spadek prędkości', short: 'Spadek', unit: '%', icon: 'trend', format: (r) => (r.velocityLoss > 0 ? `-${fmt(r.velocityLoss * 100, 0)}` : '0') },
  duration: { label: 'Czas koncentryczny', short: 'Czas', unit: 's', icon: 'clock', format: (r) => fmt(r.duration, 2) },
  timeToPeak: { label: 'Czas do max', short: 'Do max', unit: 'ms', icon: 'clock', format: (r) => fmt(r.timeToPeak * 1000, 0) },
};

export const MAX_TILES = 3;

/** What the centre of the ring shows (the main value). Keys other than zonePercent are METRICS keys. */
export const RING_METRICS = {
  meanVelocity: { label: 'Prędkość śr.', short: 'PRĘDKOŚĆ ŚR' },
  peakVelocity: { label: 'Prędkość max', short: 'PRĘDKOŚĆ MAX' },
  rom: { label: 'Odległość', short: 'ODLEGŁOŚĆ' },
  power: { label: 'Moc śr.', short: 'MOC ŚR' },
  peakPower: { label: 'Moc max', short: 'MOC MAX' },
  zonePercent: { label: '% w strefie', short: 'W STREFIE' },
};

export const EXERCISES = [
  'Przysiad', 'Przysiad przedni', 'Martwy ciąg', 'Martwy ciąg rumuński', 'Wyciskanie leżąc',
  'Wyciskanie nad głowę', 'Wiosłowanie', 'Podciąganie', 'Hip thrust', 'Zarzut', 'Rwanie', 'Skok z obciążeniem',
];

export const DEFAULT_SETTINGS = {
  direction: 'out',
  ringMetric: 'meanVelocity',
  tiles: ['power', 'peakVelocity', 'rom'],
  lossWarnPercent: 20,
  setGapSeconds: 30,
  vibrate: true,
  beep: false,
  activeZoneId: null,
  zones: null, // [{id, name, description, min, max, icon}]; null = PRESET_ZONES
  athleteId: null,
  exercise: '',
  load: 0, // kg
};

const KEY = 'vbt.settings.v1';

export function fmt(value, digits) {
  return value.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // v1 had heroMetric; the ring centre replaced it.
    if (saved.heroMetric && !saved.ringMetric) saved.ringMetric = RING_METRICS[saved.heroMetric] ? saved.heroMetric : 'meanVelocity';
    delete saved.heroMetric;
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    settings.tiles = settings.tiles.filter((k) => METRICS[k]).slice(0, MAX_TILES);
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private mode or storage blocked: settings just won't persist
  }
}

/** Rough Li-ion state of charge from the sensor's reported voltage (3.3 V empty, 4.15 V full). */
export const batteryPercent = (volts) => Math.round(Math.max(0, Math.min(1, (volts - 3.3) / 0.85)) * 100);
