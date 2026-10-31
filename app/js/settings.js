// User preferences, kept per device in localStorage.

const G = 9.81;

export const METRICS = {
  meanVelocity: { label: 'Prędkość średnia', short: 'Średnia', unit: 'm/s', icon: 'speed', format: (r) => fmt(r.meanVelocity, 2) },
  peakVelocity: { label: 'Prędkość max', short: 'Max', unit: 'm/s', icon: 'gauge', format: (r) => fmt(r.peakVelocity, 2) },
  power: {
    label: 'Moc średnia', short: 'Moc', unit: 'W', icon: 'bolt',
    // Mean concentric power of lifting the bar: m * g * v. Needs the load to be set.
    format: (r, set) => (set?.load > 0 ? fmt(set.load * G * r.meanVelocity, 0) : '–'),
  },
  rom: { label: 'Zakres ruchu', short: 'Zakres', unit: 'cm', icon: 'ruler', format: (r) => fmt(r.rom, 0) },
  velocityLoss: { label: 'Spadek prędkości', short: 'Spadek', unit: '%', icon: 'trend', format: (r) => (r.velocityLoss > 0 ? `-${fmt(r.velocityLoss * 100, 0)}` : '0') },
  duration: { label: 'Czas koncentryczny', short: 'Czas', unit: 's', icon: 'clock', format: (r) => fmt(r.duration, 2) },
  timeToPeak: { label: 'Czas do max', short: 'Do max', unit: 'ms', icon: 'clock', format: (r) => fmt(r.timeToPeak * 1000, 0) },
};

export const MAX_TILES = 3;

/** What the centre of the ring shows. */
export const RING_METRICS = {
  meanVelocity: { label: 'Średnia', short: 'ŚR' },
  peakVelocity: { label: 'Max', short: 'MAX' },
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
