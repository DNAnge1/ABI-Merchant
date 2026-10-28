export type BrowserKind = 'chrome' | 'edge' | 'brave' | 'chromium' | 'firefox' | 'safari' | 'other';

export interface BrowserInfo {
  kind: BrowserKind;
  label: string;
  /** Chromium-family browsers that can share tab/window/system audio reliably enough for this app. */
  autoCaptureSupported: boolean;
}

export function detectBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): BrowserInfo {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { brave?: { isBrave?: unknown } }) : null;
  if (nav?.brave || /Brave/i.test(ua)) {
    return { kind: 'brave', label: 'Brave', autoCaptureSupported: true };
  }
  if (/Edg\//i.test(ua)) {
    return { kind: 'edge', label: 'Microsoft Edge', autoCaptureSupported: true };
  }
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) {
    return { kind: 'chrome', label: 'Google Chrome', autoCaptureSupported: true };
  }
  if (/Chromium/i.test(ua)) {
    return { kind: 'chromium', label: 'Chromium', autoCaptureSupported: true };
  }
  if (/Firefox\//i.test(ua)) {
    return { kind: 'firefox', label: 'Firefox', autoCaptureSupported: false };
  }
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    return { kind: 'safari', label: 'Safari', autoCaptureSupported: false };
  }
  return { kind: 'other', label: 'This browser', autoCaptureSupported: false };
}

export function supportsGetDisplayMedia(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

export type VerifyPhase =
  | 'idle'
  | 'unsupported'
  | 'prompting'
  | 'no-audio'
  /** Share succeeded; meter runs — silence is OK (not in raid yet). */
  | 'waiting'
  | 'metering'
  | 'ok'
  | 'error';

export interface VerifyState {
  phase: VerifyPhase;
  message: string;
  rms: number;
  peakRms: number;
  hasAudioTrack: boolean;
  /** Multi-line / detailed diagnostics for the Verify panel */
  detail?: string;
}

/** Play a short ~440Hz beep through speakers (for "can you hear the game?" checks). */
export async function playTestTone(durationMs = 400, frequency = 880): Promise<void> {
  const ctx = new AudioContext();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    await new Promise((r) => setTimeout(r, durationMs + 50));
    osc.stop();
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export function rmsFromAnalyser(analyser: AnalyserNode): number {
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

export function browserFixSteps(info: BrowserInfo): string[] {
  switch (info.kind) {
    case 'chrome':
    case 'edge':
    case 'chromium':
      return [
        'Share a Chrome/Edge tab with “Share tab audio” (most reliable).',
        'Entire Screen + system audio can fail with “Could not start audio source” — that’s an OS loopback issue, not a timeout.',
        'Windows: set a working default input; turn off Exclusive Mode on playback devices; close Discord exclusive / DAWs.',
        'Silence after a good share is normal until you’re at Field Merchant.',
      ];
    case 'brave':
      return [
        'Set Shields Down for this site.',
        'Prefer tab share + “Share tab audio”. Same Windows loopback tips as Chrome if system audio fails.',
      ];
    case 'firefox':
    case 'safari':
      return [
        `${info.label} can’t reliably share game audio here — use Chrome/Edge or Manual Mode.`,
      ];
    default:
      return ['Use Chrome or Edge for Automatic Mode, or Manual Mode by ear.'];
  }
}
