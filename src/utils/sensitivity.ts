/**
 * Onset / match sensitivity presets for Automatic Mode.
 * Low = stricter (fewer false positives from footsteps/ambient).
 * Mic/loopback runs one notch stricter than the UI selection.
 */

export type SensitivityLevel = 'low' | 'med' | 'high';

export interface SensitivityPreset {
  /** Absolute RMS floor (analyser time-domain). */
  noiseFloor: number;
  /** Minimum RMS jump above recent baseline (sharp transient). */
  fluxThreshold: number;
  /** Reject cosine matches below this % (0–100). */
  minConfidence: number;
  /** Ignore onsets for this many ms after Start Listening. */
  startGraceMs: number;
  /** Peak energy of the capture slice must fall in this window (ms from onset). */
  peakWindowMs: [number, number];
  label: string;
  hint: string;
}

export const SENSITIVITY_PRESETS: Record<SensitivityLevel, SensitivityPreset> = {
  low: {
    noiseFloor: 0.26,
    fluxThreshold: 0.11,
    minConfidence: 65,
    startGraceMs: 500,
    // Peak may sit at onset (t≈0); reject only late/sustained energy past ~merchant attack.
    peakWindowMs: [0, 380],
    label: 'Low',
    hint: 'Strict — best against footsteps / ambient (recommended for mic)',
  },
  med: {
    noiseFloor: 0.2,
    fluxThreshold: 0.075,
    minConfidence: 60,
    startGraceMs: 400,
    peakWindowMs: [0, 400],
    label: 'Med',
    hint: 'Balanced for screen share',
  },
  high: {
    noiseFloor: 0.14,
    fluxThreshold: 0.045,
    minConfidence: 55,
    startGraceMs: 300,
    peakWindowMs: [0, 450],
    label: 'High',
    hint: 'More sensitive — quieter game audio; more false positives',
  },
};

/** Mic/loopback is noisier — run one step stricter than the UI selection. */
export function effectiveSensitivity(
  level: SensitivityLevel,
  sourceKind: 'display' | 'microphone' | null | undefined,
): SensitivityLevel {
  if (sourceKind !== 'microphone') return level;
  if (level === 'high') return 'med';
  return 'low';
}

export function presetFor(
  level: SensitivityLevel,
  sourceKind?: 'display' | 'microphone' | null,
): SensitivityPreset {
  return SENSITIVITY_PRESETS[effectiveSensitivity(level, sourceKind)];
}
