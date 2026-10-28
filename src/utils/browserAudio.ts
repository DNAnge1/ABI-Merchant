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
        'Preferred: share a Chrome/Edge tab that has game audio (or Discord/OBS monitoring) with “Share tab audio” checked — most reliable.',
        'Entire Screen + “Also share system audio” (Windows) often throws Chromium NotReadableError “Could not start audio source” when WASAPI loopback fails.',
        'Windows: Settings → System → Sound → Input — set a working microphone/Stereo Mix as default; disable Exclusive Mode on playback devices.',
        'Close apps that grab exclusive audio (Discord “Exclusive Mode”, some DAWs, steelseries/sonic drivers), then retry.',
        'Keep ABI unmuted and move over Field Merchant items while the meter runs.',
      ];
    case 'brave':
      return [
        'Brave Shields can block capture — set Shields Down for this site.',
        'Then prefer sharing a Brave/Chrome tab with “Share tab audio”, or Entire Screen + system audio.',
        'If you see “Could not start audio source”, fix Windows default recording device / exclusive-mode apps (same as Chrome).',
      ];
    case 'firefox':
    case 'safari':
      return [
        `${info.label} does not reliably expose system/game audio via getDisplayMedia for this tool.`,
        'Use Google Chrome or Microsoft Edge for Automatic Mode.',
        'Or switch to Manual Mode and match by ear with the Sound Board.',
      ];
    default:
      return [
        'Use Google Chrome or Microsoft Edge for Automatic Mode.',
        'Or switch to Manual Mode and pick Sound IDs by ear.',
      ];
  }
}
