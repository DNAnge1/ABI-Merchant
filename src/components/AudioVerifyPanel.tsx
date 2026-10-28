import type { ReactNode } from 'react';
import { browserFixSteps, detectBrowser, type VerifyState } from '../utils/browserAudio';
import { MicLoopbackFallback } from './MicLoopbackFallback';
export { playTestTone } from '../utils/browserAudio';

function looksLikeDisplayAudioFail(message: string | undefined): boolean {
  if (!message) return false;
  return (
    /Could not start audio source/i.test(message) ||
    /NotReadableError/i.test(message) ||
    /system-audio loopback/i.test(message) ||
    /0 tracks/i.test(message)
  );
}

export function AudioVerifyPanel(props: {
  open: boolean;
  state: VerifyState;
  onClose: () => void;
  onRetry: () => void;
  onSwitchManual: () => void;
  onPlayTone: () => void;
  /** Jump straight into live Automatic listening using this verified share when possible */
  onStartListening?: () => void;
  /** Fallback: open mic/loopback for Verify meter or live listen */
  onUseMicLoopback?: (deviceId: string | undefined) => void;
  micBusy?: boolean;
  /** Force showing mic fallback (e.g. after Live Start NotReadableError) */
  suggestMicFallback?: boolean;
}) {
  if (!props.open) return null;
  const browser = detectBrowser();
  const steps = browserFixSteps(browser);
  const failed =
    props.state.phase === 'unsupported' ||
    props.state.phase === 'no-audio' ||
    props.state.phase === 'error';
  const liveMeter =
    props.state.phase === 'metering' ||
    props.state.phase === 'waiting' ||
    props.state.phase === 'ok';
  const meterPct = Math.min(100, Math.round(props.state.rms * 400));
  const silent = props.state.hasAudioTrack && props.state.peakRms < 0.02;
  const displayFail =
    props.suggestMicFallback ||
    (props.state.phase === 'error' && looksLikeDisplayAudioFail(props.state.message)) ||
    (props.state.phase === 'no-audio' && looksLikeDisplayAudioFail(props.state.message));
  const showMicFallback = !!props.onUseMicLoopback && browser.autoCaptureSupported;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold tracking-wide text-[var(--accent)]">
            Verify audio access
          </h2>
          <p className="m-0 mt-1 text-[12px] text-[var(--muted)] max-w-2xl leading-relaxed">
            Optional check that Chrome can hear game audio. This is{' '}
            <strong className="text-[var(--text)]">not</strong> the live scanner — silence is OK if
            you’re not in a raid. Automatic Mode can use <strong className="text-[var(--text)]">screen
            share</strong> or a <strong className="text-[var(--text)]">mic / loopback</strong> input.
          </p>
          <p className="m-0 mt-1 text-[11px] text-[var(--muted)]">
            Browser: <span className="text-[var(--text)]">{browser.label}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          Close
        </button>
      </div>

      <ol className="m-0 mt-3 grid gap-2 list-none p-0 sm:grid-cols-3">
        <Step n={1} title="Share or mic">
          Prefer tab + “Share tab audio”. If Entire Screen fails (G560), use{' '}
          <strong>mic / loopback</strong> below.
        </Step>
        <Step n={2} title="Confirm track">
          Success = any audio track connects. Silence is OK — you do not need merchant sounds yet.
        </Step>
        <Step n={3} title="Exclusive ≠ Allow">
          Site microphone Allow is not enough. For G560: classic Sound → Playback → Properties →
          Advanced → uncheck exclusive control.
        </Step>
      </ol>

      {props.state.phase === 'unsupported' && (
        <div className="mt-3 rounded border border-[var(--warn)]/50 bg-[#2a2208] px-3 py-2 text-xs text-[var(--warn)]">
          <strong className="block mb-1">{browser.label} is not supported for Automatic Mode</strong>
          Use Chrome or Edge, or switch to Manual Mode.
        </div>
      )}

      {props.state.phase === 'no-audio' && (
        <div className="mt-3 rounded border border-[var(--mythic)]/50 bg-[#2a1014] px-3 py-2 text-xs text-[#ffb4bc]">
          <strong className="block mb-1">No audio track</strong>
          The share picker returned video only. Re-share with tab/system audio, or use mic / loopback.
          {props.state.detail && (
            <pre className="m-0 mt-2 max-h-28 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--muted)] whitespace-pre-wrap">
              {props.state.detail}
            </pre>
          )}
        </div>
      )}

      {props.state.phase === 'error' && (
        <div className="mt-3 rounded border border-[var(--mythic)]/40 bg-[#2a1014] px-3 py-2 text-xs text-[#ffb4bc]">
          <strong className="block mb-1">
            {displayFail ? 'Screen / system audio failed' : 'Could not open capture'}
          </strong>
          <p className="m-0 whitespace-pre-wrap break-words">{props.state.message}</p>
          {displayFail && (
            <p className="m-0 mt-2 text-[11px] text-[var(--mythic-gold)]">
              Chromium could not open OS loopback (common with Logitech G560 exclusive mode). You can
              still run Automatic Mode — use the <strong>microphone / loopback</strong> fallback below
              (VB-Cable / Stereo Mix), or fix exclusive mode and retry tab share.
            </p>
          )}
          {props.state.detail && (
            <pre className="m-0 mt-2 max-h-36 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--muted)] whitespace-pre-wrap">
              {props.state.detail}
            </pre>
          )}
        </div>
      )}

      {/* Prominent mic fallback immediately under display-audio failure */}
      {showMicFallback && displayFail && (
        <MicLoopbackFallback
          prominent
          busy={props.micBusy}
          onUseDevice={(id) => props.onUseMicLoopback?.(id)}
        />
      )}

      {(props.state.phase === 'prompting' || props.state.phase === 'idle') && (
        <p className="m-0 mt-3 text-xs text-[var(--muted)]">
          {props.state.message || 'Waiting for the browser share dialog…'}
        </p>
      )}

      {liveMeter && (
        <div className="mt-3 rounded border border-[var(--accent)]/40 bg-[var(--bg-elevated)] px-3 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--ok)]">
                Audio track connected
              </p>
              <p className="m-0 mt-0.5 text-[12px] text-[var(--text)]">
                Waiting for merchant sounds — you can stay here until you reach Field Merchant.
              </p>
            </div>
            <span className="tabular-nums text-[11px] text-[var(--muted)]">
              RMS {(props.state.rms * 100).toFixed(1)} · peak {(props.state.peakRms * 100).toFixed(1)}
            </span>
          </div>
          <div className="h-2 rounded bg-black/40 overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-75"
              style={{ width: `${meterPct}%` }}
            />
          </div>
          {silent ? (
            <p className="m-0 text-[11px] text-[var(--warn)]">
              No signal yet — that’s fine if you’re in lobby / not at the merchant. Silence is not a
              failure. When you drag cargo in-raid, this meter (or Live Listening) should spike.
            </p>
          ) : (
            <p className="m-0 text-[11px] text-[var(--ok)]">Signal detected on the shared audio track.</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void props.onPlayTone()}
              className="rounded px-2 py-1 text-[11px] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
            >
              Play Test Tone
            </button>
            {props.onStartListening && (
              <button
                type="button"
                onClick={props.onStartListening}
                className="rounded px-2.5 py-1 text-[11px] font-semibold bg-[var(--accent)] text-[#041412]"
              >
                Start Listening (live)
              </button>
            )}
            <button
              type="button"
              onClick={props.onClose}
              className="rounded px-2.5 py-1 text-[11px] border border-[var(--border)] text-[var(--muted)]"
            >
              Done with verify
            </button>
          </div>
        </div>
      )}

      {/* Always offer mic path when not already in a live meter success (unless shown above) */}
      {showMicFallback && !displayFail && !liveMeter && (
        <MicLoopbackFallback
          busy={props.micBusy}
          onUseDevice={(id) => props.onUseMicLoopback?.(id)}
        />
      )}

      {(failed || browser.kind === 'brave' || browser.kind === 'chrome' || browser.kind === 'edge') && (
        <details className="mt-3 rounded border border-[var(--border)] bg-[var(--bg)]/60 px-3 py-2" open={failed && !displayFail}>
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Troubleshooting · {browser.label}
          </summary>
          <ol className="m-0 mt-2 pl-4 text-[12px] text-[var(--text)] leading-relaxed space-y-2">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={props.onRetry}
              className="rounded px-2.5 py-1.5 text-[11px] font-medium bg-[var(--accent)] text-[#041412]"
            >
              Retry screen share
            </button>
            <button
              type="button"
              onClick={props.onSwitchManual}
              className="rounded px-2.5 py-1.5 text-[11px] font-medium border border-[var(--mythic)]/60 text-[var(--mythic-gold)]"
            >
              Switch to Manual Mode
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

function Step(props: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="rounded border border-[var(--border)] bg-[var(--bg)]/50 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold text-[var(--accent)]">{props.n}</span>
        <span className="text-[11px] font-semibold text-[var(--text)]">{props.title}</span>
      </div>
      <p className="m-0 mt-1 text-[11px] text-[var(--muted)] leading-relaxed">{props.children}</p>
    </li>
  );
}
