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

/** Encode mono Float32 PCM (−1…1) as a 16-bit WAV Blob for Play / Download. */
export function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let o = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Concatenate Float32 chunks into one buffer (burst PCM capture). */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function browserFixSteps(info: BrowserInfo): string[] {
  switch (info.kind) {
    case 'chrome':
    case 'edge':
    case 'chromium':
      return [
        'NotReadableError / “Could not start audio source”: use Mic / loopback first (VB-Cable, Stereo Mix) — Automatic Mode still works. Chrome Tab won’t capture ABI desktop game audio.',
        'Entire Screen + system audio often fails on G560 even after exclusive mode is off — mic/loopback is the reliable path for desktop ABI.',
        'Exclusive mode (≠ site Allow): Win+R → mmsys.cpl → Enter · Playback → right-click default device → Properties → Advanced · Uncheck “Allow applications to take exclusive control of this device” → Apply → OK · Repeat under Recording for default recording device.',
        'Silence after a good share/mic attach is normal until you’re at Field Merchant.',
      ];
    case 'brave':
      return [
        'Set Shields Down for this site.',
        'If system audio fails: Mic / loopback (VB-Cable / Stereo Mix). Chrome Tab won’t hear desktop ABI.',
      ];
    case 'firefox':
    case 'safari':
      return [
        `${info.label} can’t reliably share game audio here — use Chrome/Edge with mic/loopback, or Manual Mode.`,
      ];
    default:
      return ['Use Chrome or Edge with mic/loopback for Automatic Mode, or Manual Mode by ear.'];
  }
}
