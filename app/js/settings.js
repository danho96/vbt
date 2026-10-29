// User preferences, kept per device in localStorage.

export const METRICS = {
  meanVelocity: { label: 'Prędkość średnia', short: 'Średnia', unit: 'm/s', format: (r) => fmt(r.meanVelocity, 2) },
  peakVelocity: { label: 'Prędkość max', short: 'Max', unit: 'm/s', format: (r) => fmt(r.peakVelocity, 2) },
  velocityLoss: { label: 'Spadek prędkości', short: 'Spadek', unit: '%', format: (r) => (r.velocityLoss > 0 ? `-${fmt(r.velocityLoss * 100, 0)}` : '0') },
  rom: { label: 'Zakres ruchu', short: 'Zakres', unit: 'cm', format: (r) => fmt(r.rom, 0) },
  duration: { label: 'Czas koncentryczny', short: 'Czas', unit: 's', format: (r) => fmt(r.duration, 2) },
  timeToPeak: { label: 'Czas do max', short: 'Do max', unit: 's', format: (r) => fmt(r.timeToPeak, 2) },
};

export const DEFAULT_SETTINGS = {
  direction: 'out',
  heroMetric: 'meanVelocity',
  tiles: ['peakVelocity', 'velocityLoss'],
  lossWarnPercent: 20,
  setGapSeconds: 30,
  vibrate: true,
  beep: false,
};

const KEY = 'vbt.settings.v1';

export function fmt(value, digits) {
  return value.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
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
