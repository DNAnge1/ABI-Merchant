import type { ReactNode } from 'react';
import { browserFixSteps, detectBrowser, type VerifyState } from '../utils/browserAudio';
import { EXCLUSIVE_MODE_STEPS } from '../utils/micCapture';
import { MicLoopbackFallback } from './MicLoopbackFallback';
export { playTestTone } from '../utils/browserAudio';

export type KnownVerifyErrorKind =
  | 'not-allowed'
  | 'not-readable'
  | 'no-audio'
  | 'unsupported'
  | 'generic';

export function classifyVerifyError(
  state: VerifyState,
  suggestMicFallback?: boolean,
): KnownVerifyErrorKind {
  if (state.phase === 'unsupported') return 'unsupported';
  if (state.phase === 'no-audio') return 'no-audio';

  const blob = `${state.message ?? ''}\n${state.detail ?? ''}`;
  if (/NotAllowedError|Permission denied|share (canceled|cancelled|denied)|AbortError/i.test(blob)) {
    return 'not-allowed';
  }
  if (
    suggestMicFallback ||
    /NotReadableError|Could not start audio source|audioTracks=0|0 tracks|system-audio loopback|G560/i.test(
      blob,
    )
  ) {
    return 'not-readable';
  }
  if (state.phase === 'error') return 'generic';
  return 'generic';
}

function knownErrorCopy(kind: KnownVerifyErrorKind): {
  title: string;
  summary: string;
  steps: string[];
} {
  switch (kind) {
    case 'not-allowed':
      return {
        title: 'Share canceled or denied',
        summary: 'Chrome didn’t get permission to share audio (or you closed the picker).',
        steps: [
          'Click Retest, then pick your game window or Entire Screen.',
          'Turn on “Share audio” / “Also share system audio” before Share.',
        ],
      };
    case 'not-readable':
      return {
        title: 'Couldn’t read system audio',
        summary:
          'Screen-share loopback failed (common on G560 / exclusive-mode devices). Mic / loopback still works for Automatic Mode.',
        steps: [
          'Prefer Mic / loopback below (VB-Cable or Stereo Mix) — Chrome Tab won’t hear desktop ABI.',
          'Optional: Win+R → mmsys.cpl → Playback → Properties → Advanced → uncheck exclusive control (repeat under Recording).',
        ],
      };
    case 'no-audio':
      return {
        title: 'No audio track in the share',
        summary: 'The picker returned video only — no audio track to listen to.',
        steps: [
          'Retest and enable Share audio, or use Mic / loopback (VB-Cable / Stereo Mix).',
          'Chrome Tab won’t capture desktop ABI game audio — pick window/screen with audio, or mic path.',
        ],
      };
    case 'unsupported':
      return {
        title: 'Browser not supported for Automatic',
        summary: 'Use Chrome or Edge for Automatic Mode, or switch to Manual.',
        steps: ['Open this site in Chrome or Edge, or use Switch to Manual.'],
      };
    default:
      return {
        title: 'Could not open capture',
        summary: 'Something blocked audio capture. Retest, or switch to Manual / Mic loopback.',
        steps: ['Click Retest and try again.', 'If it keeps failing, open More troubleshooting below.'],
      };
  }
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
  /** Clear error + retry live Start Listening (recover from G560 / device switch). */
  onRetestListening?: () => void;
  /** Return to Entry and wipe error UI. */
  onStartOver?: () => void;
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
  const errorKind = classifyVerifyError(props.state, props.suggestMicFallback);
  const known = knownErrorCopy(errorKind);
  const micIsKnownFix = errorKind === 'not-readable' || errorKind === 'no-audio';
  const showMicFallback = !!props.onUseMicLoopback && browser.autoCaptureSupported;
  const techBlob = [props.state.message, props.state.detail].filter(Boolean).join('\n\n');
  const retest = () => {
    if (props.onRetestListening) props.onRetestListening();
    else props.onRetry();
  };

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold tracking-wide text-[var(--accent)]">
            Verify audio access
          </h2>
          {!failed && (
            <p className="m-0 mt-1 text-[12px] text-[var(--muted)] max-w-2xl leading-relaxed">
              Optional check that Chrome can hear game audio — not the live scanner. Silence is OK
              if you’re not in a raid. Desktop ABI: prefer Mic / loopback over Chrome Tab.
            </p>
          )}
          <p className="m-0 mt-1 text-[11px] text-[var(--muted)]">
            Browser: <span className="text-[var(--text)]">{browser.label}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded px-2.5 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] border border-transparent hover:border-[var(--border)] shrink-0"
        >
          Clear & close
        </button>
      </div>

      {failed && (
        <div className="mt-3 space-y-2.5">
          {/* One primary Retest above the error card */}
          <button
            type="button"
            onClick={retest}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110"
          >
            Retest
          </button>

          <div className="rounded-lg border border-[var(--mythic)]/40 bg-[#2a1014] px-3 py-3 space-y-2">
            <p className="m-0 text-[13px] font-semibold text-[#ffb4bc]">{known.title}</p>
            <p className="m-0 text-[12px] text-[var(--text)] leading-relaxed">{known.summary}</p>
            <ol className="m-0 pl-4 space-y-1 text-[12px] text-[var(--text)] leading-relaxed">
              {known.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>

            <details className="rounded border border-[var(--border)]/60 bg-black/25 px-2.5 py-1.5">
              <summary className="cursor-pointer text-[11px] font-medium text-[var(--muted)]">
                Details ▾
              </summary>
              <div className="mt-2 space-y-2">
                {techBlob ? (
                  <pre className="m-0 max-h-36 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--muted)] whitespace-pre-wrap break-words font-mono">
                    {techBlob}
                  </pre>
                ) : (
                  <p className="m-0 text-[11px] text-[var(--muted)]">No extra diagnostics.</p>
                )}
                {techBlob && (
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(techBlob)}
                    className="rounded px-2.5 py-1 text-[11px] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
                  >
                    Copy
                  </button>
                )}
              </div>
            </details>
          </div>

          {/* Quiet secondary actions — not competing with Retest */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <button
              type="button"
              onClick={props.onSwitchManual}
              className="bg-transparent border-none p-0 text-[var(--muted)] underline underline-offset-2 hover:text-[var(--mythic-gold)] cursor-pointer"
            >
              Switch to Manual
            </button>
            {props.onStartOver && (
              <button
                type="button"
                onClick={props.onStartOver}
                className="bg-transparent border-none p-0 text-[var(--muted)] underline underline-offset-2 hover:text-[var(--text)] cursor-pointer"
              >
                Start over
              </button>
            )}
            <button
              type="button"
              onClick={props.onRetry}
              className="bg-transparent border-none p-0 text-[var(--muted)] underline underline-offset-2 hover:text-[var(--text)] cursor-pointer"
            >
              Retry screen-share verify
            </button>
          </div>

          <details
            className="rounded border border-[var(--border)] bg-[var(--bg)]/60 px-3 py-2"
            open={micIsKnownFix}
          >
            <summary className="cursor-pointer text-[11px] font-semibold text-[var(--muted)]">
              More troubleshooting & Mic/Loopback ▾
            </summary>
            <div className="mt-2 space-y-3">
              {showMicFallback && (
                <MicLoopbackFallback
                  prominent={micIsKnownFix}
                  busy={props.micBusy}
                  expandGuides={false}
                  onUseDevice={(id) => props.onUseMicLoopback?.(id)}
                />
              )}
              {errorKind === 'not-readable' && (
                <div className="rounded border border-[var(--border)]/80 bg-[var(--bg)]/40 px-2.5 py-2">
                  <p className="m-0 text-[11px] font-semibold text-[var(--muted)]">
                    Exclusive mode (optional)
                  </p>
                  <ol className="m-0 mt-1 pl-4 space-y-1 text-[11px] text-[var(--text)] leading-relaxed">
                    {EXCLUSIVE_MODE_STEPS.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
              <div>
                <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {browser.label} tips
                </p>
                <ol className="m-0 mt-1.5 pl-4 text-[12px] text-[var(--text)] leading-relaxed space-y-1.5">
                  {steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
              <ol className="m-0 grid gap-2 list-none p-0 sm:grid-cols-3">
                <Step n={1} title="Mic / loopback first">
                  For desktop ABI, use Mic / loopback (VB-Cable / Stereo Mix). Chrome Tab won’t
                  capture game audio.
                </Step>
                <Step n={2} title="Confirm track">
                  Success = any audio track connects. Silence is OK — you don’t need merchant sounds
                  yet.
                </Step>
                <Step n={3} title="Exclusive ≠ Allow">
                  Site Allow isn’t exclusive mode. Use the mmsys.cpl steps above.
                </Step>
              </ol>
            </div>
          </details>
        </div>
      )}

      {!failed && (
        <ol className="m-0 mt-3 grid gap-2 list-none p-0 sm:grid-cols-3">
          <Step n={1} title="Mic / loopback first">
            For desktop ABI, use <strong>Mic / loopback</strong> (VB-Cable / Stereo Mix). Chrome Tab
            won’t capture game audio.
          </Step>
          <Step n={2} title="Confirm track">
            Success = any audio track connects. Silence is OK — you do not need merchant sounds yet.
          </Step>
          <Step n={3} title="Exclusive ≠ Allow">
            Site Allow isn’t exclusive mode. Use Mic / loopback tips if share fails.
          </Step>
        </ol>
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
              No signal yet — fine if you’re in lobby. When you drag cargo in-raid, this meter should
              spike.
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

      {showMicFallback && !failed && !liveMeter && (
        <MicLoopbackFallback
          busy={props.micBusy}
          expandGuides={false}
          onUseDevice={(id) => props.onUseMicLoopback?.(id)}
        />
      )}

      {!failed &&
        (browser.kind === 'brave' || browser.kind === 'chrome' || browser.kind === 'edge') && (
          <details className="mt-3 rounded border border-[var(--border)] bg-[var(--bg)]/60 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              Troubleshooting · {browser.label} ▾
            </summary>
            <ol className="m-0 mt-2 pl-4 text-[12px] text-[var(--text)] leading-relaxed space-y-2">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
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
