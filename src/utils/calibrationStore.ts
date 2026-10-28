/**
 * Client-side accuracy / calibration log.
 * Schema is DB-ready (stable IDs + schemaVersion); today: localStorage + JSON export.
 */

export const CALIBRATION_SCHEMA_VERSION = 1 as const;
export const CALIBRATION_STORAGE_KEY = 'abi-merchant.calibration.v1';

export type MonitorSetup = 'single' | 'dual';
export type ScanStyle = 'single' | 'continuous';
export type FeedbackKind = 'up' | 'down' | 'skip' | 'dismiss';

export interface CalibrationEvent {
  id: string;
  schemaVersion: typeof CALIBRATION_SCHEMA_VERSION;
  ts: string;
  sessionId: string;
  appMode: 'automatic' | 'manual';
  monitorSetup: MonitorSetup;
  scanStyle: ScanStyle;
  predictedSoundId: number;
  predictedConfidence: number;
  predictedRedPct: number;
  feedback: FeedbackKind;
  /** Corrected Sound ID when thumbs-down */
  actualSoundId?: number;
  actualItemId?: number;
  actualItemName?: string;
  /** Compact spectral snapshot for later fingerprint refinement */
  spectrumVector?: number[];
  spectralCentroid?: number;
  notes?: string;
}

export interface CalibrationStoreFile {
  schemaVersion: typeof CALIBRATION_SCHEMA_VERSION;
  exportedAt: string;
  sessionId: string;
  events: CalibrationEvent[];
  /** Reserved for a future remote DB sync cursor */
  sync?: { lastPushedId?: string; backend?: string };
}

export interface AccuracyStats {
  totalScans: number;
  thumbsUp: number;
  thumbsDown: number;
  skips: number;
  /** Predictions with Red% > 0 that received 👍 */
  redsFound: number;
  /** thumbsUp / (thumbsUp + thumbsDown) * 100, or 0 if none */
  accuracyPct: number;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newSessionId(): string {
  return `sess-${uid()}`;
}

function loadRaw(): CalibrationEvent[] {
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { events?: CalibrationEvent[] };
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

function saveRaw(events: CalibrationEvent[]) {
  const payload: CalibrationStoreFile = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessionId: events[0]?.sessionId || '',
    events,
  };
  localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(payload));
}

export function listCalibrationEvents(): CalibrationEvent[] {
  return loadRaw();
}

export function appendCalibrationEvent(
  partial: Omit<CalibrationEvent, 'id' | 'schemaVersion' | 'ts'>,
): CalibrationEvent {
  const event: CalibrationEvent = {
    ...partial,
    id: uid(),
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    ts: new Date().toISOString(),
  };
  const events = loadRaw();
  events.push(event);
  // Cap local history so storage stays light; export before wipe if needed
  const capped = events.slice(-2000);
  saveRaw(capped);
  return event;
}

export function clearCalibrationEvents() {
  localStorage.removeItem(CALIBRATION_STORAGE_KEY);
}

export function computeAccuracyStats(events: CalibrationEvent[] = loadRaw()): AccuracyStats {
  const scored = events.filter((e) => e.feedback === 'up' || e.feedback === 'down' || e.feedback === 'skip');
  const thumbsUp = events.filter((e) => e.feedback === 'up').length;
  const thumbsDown = events.filter((e) => e.feedback === 'down').length;
  const skips = events.filter((e) => e.feedback === 'skip').length;
  const redsFound = events.filter((e) => e.feedback === 'up' && e.predictedRedPct > 0).length;
  const denom = thumbsUp + thumbsDown;
  return {
    totalScans: scored.length,
    thumbsUp,
    thumbsDown,
    skips,
    redsFound,
    accuracyPct: denom === 0 ? 0 : Math.round((thumbsUp / denom) * 1000) / 10,
  };
}

export function exportCalibrationJson(sessionId: string): string {
  const file: CalibrationStoreFile = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessionId,
    events: loadRaw(),
    sync: { backend: 'localStorage' },
  };
  return JSON.stringify(file, null, 2);
}

export function downloadCalibrationJson(sessionId: string) {
  const json = exportCalibrationJson(sessionId);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `abi-merchant-calibration-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
