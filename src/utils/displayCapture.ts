/**
 * Shared getDisplayMedia + AudioContext bootstrap for verify + matcher.
 * Surfaces Chromium's native "Could not start audio source" with diagnostics.
 */

import { detectBrowser, type BrowserInfo } from './browserAudio';

export interface TrackDiag {
  kind: 'audio' | 'video';
  label: string;
  id: string;
  readyState: MediaStreamTrackState;
  muted: boolean;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface CaptureDiagnostics {
  browser: string;
  browserKind: string;
  secureContext: boolean;
  href: string;
  audioTrackCount: number;
  videoTrackCount: number;
  tracks: TrackDiag[];
  audioContextState?: string;
  errorName?: string;
  errorMessage?: string;
  stage: string;
}

export class DisplayCaptureError extends Error {
  diagnostics: CaptureDiagnostics;
  domName?: string;

  constructor(message: string, diagnostics: CaptureDiagnostics, cause?: unknown) {
    super(message);
    this.name = 'DisplayCaptureError';
    this.diagnostics = diagnostics;
    if (cause && typeof cause === 'object' && 'name' in cause) {
      this.domName = String((cause as { name: string }).name);
    }
  }
}

function trackDiag(track: MediaStreamTrack, kind: 'audio' | 'video'): TrackDiag {
  let settings: Record<string, unknown> = {};
  try {
    settings = track.getSettings() as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {
    kind,
    label: track.label || '(unnamed)',
    id: track.id,
    readyState: track.readyState,
    muted: track.muted,
    enabled: track.enabled,
    settings,
  };
}

export function diagnoseStream(
  stream: MediaStream | null,
  stage: string,
  extras?: Partial<CaptureDiagnostics>,
): CaptureDiagnostics {
  const browser = detectBrowser();
  const audio = stream?.getAudioTracks() ?? [];
  const video = stream?.getVideoTracks() ?? [];
  return {
    browser: browser.label,
    browserKind: browser.kind,
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    href: typeof location !== 'undefined' ? location.href : '',
    audioTrackCount: audio.length,
    videoTrackCount: video.length,
    tracks: [
      ...audio.map((t) => trackDiag(t, 'audio')),
      ...video.map((t) => trackDiag(t, 'video')),
    ],
    stage,
    ...extras,
  };
}

export function formatCaptureError(err: unknown, diagnostics: CaptureDiagnostics): string {
  const browser = diagnostics.browser;
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  const msg =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : String(err ?? 'unknown');

  const lines = [
    `${browser}: ${name || 'Error'} — ${msg}`,
    `stage=${diagnostics.stage}`,
    `audioTracks=${diagnostics.audioTrackCount} videoTracks=${diagnostics.videoTrackCount}`,
  ];

  for (const t of diagnostics.tracks.filter((x) => x.kind === 'audio')) {
    lines.push(
      `audio[${t.label}] readyState=${t.readyState} muted=${t.muted} enabled=${t.enabled}`,
    );
  }

  if (diagnostics.audioContextState) {
    lines.push(`AudioContext.state=${diagnostics.audioContextState}`);
  }

  if (/could not start audio source/i.test(msg) || name === 'NotReadableError') {
    lines.push(
      'Hint: Chromium failed to open system-audio loopback (common with G560 exclusive mode). Use “Microphone / loopback” fallback (VB-Cable / Stereo Mix), or Chrome Tab + Share tab audio.',
    );
  }

  return lines.join(' · ');
}

/** Chrome/Edge DisplayMediaStreamOptions with systemAudio hint. */
export function displayMediaOptions(): DisplayMediaStreamOptions {
  // systemAudio / preferCurrentTab are Chromium extensions to the options bag
  return {
    video: true,
    audio: true,
    systemAudio: 'include',
    preferCurrentTab: false,
  } as DisplayMediaStreamOptions;
}

export type CaptureSourceKind = 'display' | 'microphone';

export interface BootstrappedCapture {
  stream: MediaStream;
  ctx: AudioContext;
  diagnostics: CaptureDiagnostics;
  browser: BrowserInfo;
  /** How the MediaStream was obtained */
  sourceKind: CaptureSourceKind;
}

/**
 * Call synchronously from a click handler so AudioContext is created under
 * user activation, then await getDisplayMedia, then resume + validate tracks.
 */
export async function captureDisplayWithAudio(
  existingCtx?: AudioContext | null,
): Promise<BootstrappedCapture> {
  const browser = detectBrowser();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new DisplayCaptureError(
      `${browser.label}: getDisplayMedia not supported`,
      diagnoseStream(null, 'preflight', {
        errorName: 'NotSupportedError',
        errorMessage: 'getDisplayMedia missing',
      }),
    );
  }

  // Create/resume AudioContext during the user gesture (before the async picker).
  const ctx = existingCtx && existingCtx.state !== 'closed' ? existingCtx : new AudioContext();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    /* continue — will re-check after share */
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions());
  } catch (err) {
    const diagnostics = diagnoseStream(null, 'getDisplayMedia', {
      errorName: err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : undefined,
      errorMessage: err instanceof Error ? err.message : String(err),
      audioContextState: ctx.state,
    });
    // Don't close a caller-owned context; only close if we created a fresh one that won't be used
    if (!existingCtx) await ctx.close().catch(() => undefined);
    throw new DisplayCaptureError(formatCaptureError(err, diagnostics), diagnostics, err);
  }

  let diagnostics = diagnoseStream(stream, 'post-getDisplayMedia', {
    audioContextState: ctx.state,
  });

  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    if (!existingCtx) await ctx.close().catch(() => undefined);
    diagnostics = { ...diagnostics, stage: 'no-audio-track' };
    throw new DisplayCaptureError(
      formatCaptureError(
        new DOMException(
          'No Audio Track Detected — share picker returned video only (enable “Also share system audio” / “Share tab audio”).',
          'NotFoundError',
        ),
        diagnostics,
      ),
      diagnostics,
    );
  }

  // Live track must be live; muted can still produce audio later but warn
  const dead = audioTracks.filter((t) => t.readyState !== 'live');
  if (dead.length === audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    if (!existingCtx) await ctx.close().catch(() => undefined);
    diagnostics = diagnoseStream(stream, 'audio-track-not-live', { audioContextState: ctx.state });
    throw new DisplayCaptureError(
      formatCaptureError(
        new DOMException('Audio track readyState is not live', 'InvalidStateError'),
        diagnostics,
      ),
      diagnostics,
    );
  }

  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch (err) {
    diagnostics = diagnoseStream(stream, 'audio-context-resume', {
      audioContextState: ctx.state,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    stream.getTracks().forEach((t) => t.stop());
    if (!existingCtx) await ctx.close().catch(() => undefined);
    throw new DisplayCaptureError(formatCaptureError(err, diagnostics), diagnostics, err);
  }

  diagnostics = diagnoseStream(stream, 'ready', { audioContextState: ctx.state });

  // Probe createMediaStreamSource early so we fail with a clear message
  try {
    const probe = ctx.createMediaStreamSource(stream);
    probe.disconnect();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    if (!existingCtx) await ctx.close().catch(() => undefined);
    diagnostics = diagnoseStream(stream, 'createMediaStreamSource', {
      audioContextState: ctx.state,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new DisplayCaptureError(formatCaptureError(err, diagnostics), diagnostics, err);
  }

  return { stream, ctx, diagnostics, browser, sourceKind: 'display' };
}

export function isCouldNotStartAudioSource(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const name =
    err && typeof err === 'object' && 'name' in err
      ? String((err as { name: string }).name)
      : err instanceof DisplayCaptureError
        ? err.domName || ''
        : '';
  const diagName =
    err instanceof DisplayCaptureError ? err.diagnostics.errorName || '' : '';
  return (
    /could not start audio source/i.test(msg) ||
    name === 'NotReadableError' ||
    diagName === 'NotReadableError'
  );
}
