import type { ReactNode } from 'react';
import { browserFixSteps, detectBrowser, type VerifyState } from '../utils/browserAudio';
export { playTestTone } from '../utils/browserAudio';

export function AudioVerifyPanel(props: {
  open: boolean;
  state: VerifyState;
  onClose: () => void;
  onRetry: () => void;
  onSwitchManual: () => void;
  onPlayTone: () => void;
  /** Jump straight into live Automatic listening using this verified share when possible */
  onStartListening?: () => void;
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

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold tracking-wide text-[var(--accent)]">
            Verify audio access
          </h2>
          <p className="m-0 mt-1 text-[12px] text-[var(--muted)] max-w-2xl leading-relaxed">
            Optional check that the browser can share audio. This is <strong className="text-[var(--text)]">not</strong> the live scanner —
            after a good share you can wait quietly (not in a raid yet is fine). Use{' '}
            <strong className="text-[var(--text)]">Start Listening</strong> for Automatic Mode.
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

      {/* Numbered how-to — always visible, low density */}
      <ol className="m-0 mt-3 grid gap-2 list-none p-0 sm:grid-cols-3">
        <Step n={1} title="Share with audio">
          Prefer a Chrome/Edge <strong>tab</strong> + “Share tab audio”. Entire Screen + system audio is optional.
        </Step>
        <Step n={2} title="Confirm track">
          Success = an audio track connects. Silence is OK — you do not need merchant sounds yet.
        </Step>
        <Step n={3} title="Then listen live">
          Close Verify (or keep meter) and click <strong>Start Listening</strong>. It waits until you drag cargo.
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
          The share picker returned video only. Re-share with tab/system audio enabled.
          {props.state.detail && (
            <pre className="m-0 mt-2 max-h-28 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--muted)] whitespace-pre-wrap">
              {props.state.detail}
            </pre>
          )}
        </div>
      )}

      {props.state.phase === 'error' && (
        <div className="mt-3 rounded border border-[var(--mythic)]/40 bg-[#2a1014] px-3 py-2 text-xs text-[#ffb4bc]">
          <strong className="block mb-1">Could not open capture</strong>
          <p className="m-0 whitespace-pre-wrap break-words">{props.state.message}</p>
          {/Could not start audio source/i.test(props.state.message || '') && (
            <p className="m-0 mt-2 text-[11px] text-[var(--mythic-gold)]">
              Chromium/OS loopback failed — try <strong>Chrome Tab + Share tab audio</strong>, or fix Windows
              recording device / exclusive-mode apps, then Retry.
            </p>
          )}
          {props.state.detail && (
            <pre className="m-0 mt-2 max-h-36 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--muted)] whitespace-pre-wrap">
              {props.state.detail}
            </pre>
          )}
        </div>
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
              No signal yet — that’s fine if you’re in lobby / not at the merchant. Silence is not a failure.
              When you drag cargo in-raid, this meter (or Live Listening) should spike.
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

      {(failed || browser.kind === 'brave' || browser.kind === 'chrome' || browser.kind === 'edge') && (
        <details className="mt-3 rounded border border-[var(--border)] bg-[var(--bg)]/60 px-3 py-2" open={failed}>
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
              Retry share
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
