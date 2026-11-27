/**
 * Advanced Troubleshoot / dry-run mode — field testing without wasting raids.
 * Opt-in only (not Suggested Settings). When on:
 * - Bypass hard-reject blank HUD; always show best-guess top IDs + confidence
 * - Continuous session PCM across soft stop / Next item (one downloadable WAV)
 * - Rich debug copy; keep capture soft-stop (no share teardown)
 */

export const TROUBLESHOOT_MODE_STORAGE_KEY = 'abi-merchant.troubleshootMode';

/** Soft cap for continuous session PCM (~4 min @ 48 kHz mono Float32 ≈ 46 MB). */
export const SESSION_PCM_MAX_SECONDS = 240;

export function isTroubleshootModeFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  return q.get('troubleshoot') === '1' || q.get('dryrun') === '1';
}

export function readTroubleshootModePref(): boolean {
  if (typeof window === 'undefined') return false;
  if (isTroubleshootModeFromUrl()) return true;
  try {
    return localStorage.getItem(TROUBLESHOOT_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTroubleshootModePref(on: boolean) {
  try {
    if (on) localStorage.setItem(TROUBLESHOOT_MODE_STORAGE_KEY, '1');
    else localStorage.removeItem(TROUBLESHOOT_MODE_STORAGE_KEY);
  } catch {
    /* ignore quota */
  }
}

/** Compact top-ID line for toasts / Copy Debug. */
export function formatTopIdsDebug(
  matches: ReadonlyArray<{ soundId: number; confidence: number }>,
  n = 5,
): string {
  if (!matches.length) return '(no scores)';
  return matches
    .slice(0, n)
    .map((m) => `#${m.soundId}@${Math.round(m.confidence * 10) / 10}%`)
    .join(' · ');
}
