/**
 * Fallback audio capture via getUserMedia (mic / virtual loopback).
 * Used when getDisplayMedia system-audio fails (NotReadableError / G560 exclusive mode).
 */

import {
  diagnoseStream,
  DisplayCaptureError,
  formatCaptureError,
  type BootstrappedCapture,
  type CaptureDiagnostics,
} from './displayCapture';
import { detectBrowser } from './browserAudio';

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

/** Request a brief mic permission so enumerateDevices returns labels. */
export async function ensureMicPermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DisplayCaptureError(
      'getUserMedia not supported',
      diagnoseStream(null, 'mic-preflight', {
        errorName: 'NotSupportedError',
        errorMessage: 'getUserMedia missing',
      }),
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  stream.getTracks().forEach((t) => t.stop());
}

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${i + 1}`,
      groupId: d.groupId,
    }));
}

export function micAudioConstraints(deviceId?: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    // Preserve game audio spectrum for matching — disable voice processing.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId && deviceId !== 'default') {
    return { ...base, deviceId: { exact: deviceId } };
  }
  return base;
}

/**
 * Open an audio-input MediaStream (real mic or virtual cable / Stereo Mix).
 * Call under a user gesture; pass an existing AudioContext created on click.
 */
export async function captureMicWithAudio(
  deviceId?: string,
  existingCtx?: AudioContext | null,
): Promise<BootstrappedCapture> {
  const browser = detectBrowser();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DisplayCaptureError(
      `${browser.label}: getUserMedia not supported`,
      diagnoseStream(null, 'mic-preflight', {
        errorName: 'NotSupportedError',
        errorMessage: 'getUserMedia missing',
      }),
    );
  }

  const ctx = existingCtx && existingCtx.state !== 'closed' ? existingCtx : new AudioContext();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    /* continue */
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: micAudioConstraints(deviceId),
      video: false,
    });
  } catch (err) {
    const diagnostics = diagnoseStream(null, 'getUserMedia', {
      errorName:
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name: string }).name)
          : undefined,
      errorMessage: err instanceof Error ? err.message : String(err),
      audioContextState: ctx.state,
    });
    if (!existingCtx) await ctx.close().catch(() => undefined);
    throw new DisplayCaptureError(formatCaptureError(err, diagnostics), diagnostics, err);
  }

  let diagnostics: CaptureDiagnostics = diagnoseStream(stream, 'post-getUserMedia', {
    audioContextState: ctx.state,
  });

  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    if (!existingCtx) await ctx.close().catch(() => undefined);
    diagnostics = { ...diagnostics, stage: 'no-audio-track' };
    throw new DisplayCaptureError(
      formatCaptureError(
        new DOMException('No audio track from microphone / loopback device', 'NotFoundError'),
        diagnostics,
      ),
      diagnostics,
    );
  }

  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    if (!existingCtx) await ctx.close().catch(() => undefined);
    diagnostics = diagnoseStream(stream, 'audio-context-resume', {
      audioContextState: ctx.state,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new DisplayCaptureError(formatCaptureError(err, diagnostics), diagnostics, err);
  }

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

  diagnostics = diagnoseStream(stream, 'ready-mic', { audioContextState: ctx.state });
  return { stream, ctx, diagnostics, browser, sourceKind: 'microphone' };
}

/**
 * Exclusive-mode fix — use these steps verbatim in Verify / error tips.
 * Site microphone Allow is not the same as disabling exclusive control.
 */
export const EXCLUSIVE_MODE_STEPS: string[] = [
  'Win+R → mmsys.cpl → Enter',
  'Playback → right-click default device → Properties → Advanced',
  'Uncheck “Allow applications to take exclusive control of this device” → Apply → OK',
  'Repeat under Recording for default recording device',
];

/** Short docs shown in the mic/loopback fallback UI. */
export const LOOPBACK_SETUP_STEPS: { title: string; body: string }[] = [
  {
    title: 'VB-Audio Cable (recommended for ABI)',
    body: 'Install VB-Cable (or VoiceMeeter). Set Cable Input as Windows default playback (or route ABI there). In Chrome pick “CABLE Output” as the input below. Chrome Tab share cannot hear desktop ABI game audio.',
  },
  {
    title: 'Stereo Mix',
    body: 'mmsys.cpl → Recording → right-click empty area → Show Disabled Devices → enable Stereo Mix → set as Default. Pick Stereo Mix below.',
  },
  {
    title: 'Listen to this device',
    body: 'Recording device Properties → Listen → check “Listen to this device” and choose your speakers. Then pick that recording device here (or use Cable as above).',
  },
];
