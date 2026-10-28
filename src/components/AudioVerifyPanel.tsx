import { browserFixSteps, detectBrowser, type VerifyState } from '../utils/browserAudio';
export { playTestTone } from '../utils/browserAudio';

export function AudioVerifyPanel(props: {
  open: boolean;
  state: VerifyState;
  onClose: () => void;
  onRetry: () => void;
  onSwitchManual: () => void;
  onPlayTone: () => void;
}) {
  if (!props.open) return null;
  const browser = detectBrowser();
  const steps = browserFixSteps(browser);
  const failed =
    props.state.phase === 'unsupported' ||
    props.state.phase === 'no-audio' ||
    props.state.phase === 'error';
  const metering = props.state.phase === 'metering' || props.state.phase === 'ok';
  const meterPct = Math.min(100, Math.round(props.state.rms * 400));

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            Verify / Test Audio Access
          </h2>
          <p className="m-0 mt-1 text-[11px] text-[var(--muted)]">
            Detected: <span className="text-[var(--text)]">{browser.label}</span>
            {!browser.autoCaptureSupported && (
              <span className="ml-2 text-[var(--warn)]">· Automatic capture unsupported</span>
            )}
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

      {props.state.phase === 'unsupported' && (
        <div className="mt-3 rounded border border-[var(--warn)]/50 bg-[#2a2208] px-3 py-2 text-xs text-[var(--warn)]">
          <strong className="block mb-1">{browser.label} is not supported for Automatic Mode</strong>
          Firefox and Safari cannot reliably share system/game audio to this scanner. Use{' '}
          <strong>Chrome</strong> or <strong>Edge</strong>, or switch to Manual Mode below.
        </div>
      )}

      {props.state.phase === 'no-audio' && (
        <div className="mt-3 rounded border border-[var(--mythic)]/50 bg-[#2a1014] px-3 py-2 text-xs text-[#ffb4bc]">
          <strong className="block mb-1">No Audio Track Detected</strong>
          The share picker returned video only. Re-share with audio enabled (see fixes below).
        </div>
      )}

      {props.state.phase === 'error' && (
        <div className="mt-3 rounded border border-[var(--mythic)]/40 bg-[#2a1014] px-3 py-2 text-xs text-[#ffb4bc]">
          <strong className="block mb-1">Capture failed</strong>
          <p className="m-0 whitespace-pre-wrap break-words">{props.state.message || 'Audio verification failed.'}</p>
          {/Could not start audio source/i.test(props.state.message || '') && (
            <p className="m-0 mt-2 text-[11px] text-[var(--mythic-gold)]">
              This is a Chromium/OS error (usually Windows WASAPI loopback), not a missing checkbox.
              Prefer sharing a <strong>Chrome/Edge tab</strong> with “Share tab audio”, or fix the
              default recording device / exclusive-mode apps, then Retry.
            </p>
          )}
          {props.state.detail && (
            <pre className="m-0 mt-2 max-h-40 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--muted)] whitespace-pre-wrap">
              {props.state.detail}
            </pre>
          )}
        </div>
      )}

      {props.state.phase === 'no-audio' && props.state.detail && (
        <pre className="m-0 mt-2 max-h-32 overflow-auto rounded bg-black/40 p-2 text-[10px] text-[var(--muted)] whitespace-pre-wrap">
          {props.state.detail}
        </pre>
      )}

      {(props.state.phase === 'prompting' || props.state.phase === 'idle') && (
        <p className="m-0 mt-3 text-xs text-[var(--muted)]">
          {props.state.message || 'Waiting for the browser share dialog…'}
        </p>
      )}

      {metering && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--muted)]">
              Live input meter {props.state.phase === 'metering' ? '(3s sample…)' : '(ready)'}
            </span>
            <span className="tabular-nums text-[var(--text)]">
              RMS {(props.state.rms * 100).toFixed(1)} · peak {(props.state.peakRms * 100).toFixed(1)}
            </span>
          </div>
          <div className="h-2 rounded bg-black/40 overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-75"
              style={{ width: `${meterPct}%` }}
            />
          </div>
          <p className="m-0 text-[11px] text-[var(--muted)]">
            Move your cursor over ABI Field Merchant items (or drag cargo) so game audio spikes the
            meter. You should see the bar jump when the game makes sound.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void props.onPlayTone()}
              className="rounded px-2 py-1 text-[11px] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
            >
              Play Test Tone
            </button>
            {props.state.phase === 'ok' && (
              <span className="text-[11px] text-[var(--ok)] self-center font-medium">
                Audio track OK — you can Start Listening
              </span>
            )}
          </div>
        </div>
      )}

      {(failed || browser.kind === 'brave' || browser.kind === 'chrome' || browser.kind === 'edge') && (
        <div
          className={[
            'mt-3 rounded border px-3 py-2',
            failed ? 'border-[var(--border)] bg-[var(--bg)]' : 'border-[var(--border)] bg-[var(--bg)]/60',
          ].join(' ')}
        >
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Fix guide · {browser.label}
          </h3>
          <ol className="m-0 mt-1.5 pl-4 text-[11px] text-[var(--text)] space-y-1">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={props.onRetry}
              className="rounded px-2.5 py-1.5 text-[11px] font-medium bg-[var(--accent)] text-[#041412]"
            >
              Retry Verify
            </button>
            {(failed || !browser.autoCaptureSupported) && (
              <button
                type="button"
                onClick={props.onSwitchManual}
                className="rounded px-2.5 py-1.5 text-[11px] font-medium border border-[var(--mythic)]/60 text-[var(--mythic-gold)] hover:bg-[#2a1014]"
              >
                Switch to Manual Mode
              </button>
            )}
          </div>
        </div>
      )}

      {props.state.phase === 'ok' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded px-2.5 py-1.5 text-[11px] font-medium bg-[var(--accent)] text-[#041412]"
          >
            Done — ready to listen
          </button>
          <button
            type="button"
            onClick={props.onSwitchManual}
            className="rounded px-2.5 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            Switch to Manual Mode
          </button>
        </div>
      )}
    </div>
  );
}
