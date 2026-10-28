import type { MatcherStatus } from '../utils/audioMatcher';

export type AppMode = 'automatic' | 'manual';

const STEPS = [
  { id: 1, label: 'Select / Ready' },
  { id: 2, label: 'Listening' },
  { id: 3, label: 'Drag Cargo' },
  { id: 4, label: 'Match Ready' },
] as const;

function stepFromStatus(
  status: MatcherStatus,
  mode: AppMode,
  hasResult: boolean,
  detail?: string,
): { step: number; detail: string } {
  if (hasResult || status === 'done') {
    return { step: 4, detail: detail || 'Match ready' };
  }
  switch (status) {
    case 'listening':
      return {
        step: 2,
        detail: detail || 'Listening… waiting for merchant sounds (silence is OK)',
      };
    case 'capturing':
    case 'matching':
      return { step: 3, detail: detail || 'Checking sound…' };
    case 'error':
      return { step: 1, detail: detail || 'Error' };
    default:
      return {
        step: 1,
        detail:
          mode === 'automatic'
            ? detail || 'Set monitor/scan style, verify audio, then Start Listening'
            : detail || 'Manual Mode — filters + sound board',
      };
  }
}

export function StatusBar(props: {
  status: MatcherStatus;
  mode: AppMode;
  detail?: string;
  capturing: boolean;
  hasResult: boolean;
  redPct?: number | null;
  onModeChange: (mode: AppMode) => void;
  onStart: () => void;
  onStop: () => void;
  onVerify: () => void;
  /** Open Verify with mic/loopback fallback highlighted */
  onMicFallback?: () => void;
}) {
  const { step, detail } = stepFromStatus(
    props.status,
    props.mode,
    props.hasResult,
    props.detail,
  );

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur-sm px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-sm font-semibold tracking-wide text-[var(--accent)] m-0">
              ABI Field Merchant
            </h1>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Audio & Grid Scanner
            </span>
            {props.redPct != null && props.hasResult && (
              <span
                className={[
                  'rounded px-2 py-0.5 text-[11px] font-bold tabular-nums',
                  props.redPct > 0
                    ? 'bg-[var(--mythic)] text-white'
                    : 'bg-[var(--bg-panel)] text-[var(--muted)] border border-[var(--border)]',
                ].join(' ')}
              >
                RED {props.redPct}%
              </span>
            )}
          </div>
          <p className="m-0 mt-0.5 text-xs text-[var(--muted)] truncate">{detail}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded border border-[var(--border)] overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => props.onModeChange('automatic')}
              className={[
                'px-2.5 py-1.5 font-medium',
                props.mode === 'automatic'
                  ? 'bg-[var(--accent-dim)] text-[var(--text)]'
                  : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Automatic
            </button>
            <button
              type="button"
              onClick={() => props.onModeChange('manual')}
              className={[
                'px-2.5 py-1.5 font-medium border-l border-[var(--border)]',
                props.mode === 'manual'
                  ? 'bg-[var(--accent-dim)] text-[var(--text)]'
                  : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Manual
            </button>
          </div>

          <button
            type="button"
            onClick={props.onVerify}
            className="rounded px-2.5 py-1.5 text-[11px] font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
          >
            Verify / Test Audio Access
          </button>

          {props.onMicFallback && !props.capturing && props.mode === 'automatic' && (
            <button
              type="button"
              onClick={props.onMicFallback}
              className="rounded px-2.5 py-1.5 text-[11px] font-medium border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent-dim)]/30"
              title="Recommended for desktop ABI — VB-Cable / Stereo Mix (Chrome Tab won’t hear game audio)"
            >
              Mic / loopback
            </button>
          )}

          {!props.capturing ? (
            <button
              type="button"
              onClick={props.onStart}
              className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110"
            >
              Start Listening
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onStop}
              className="rounded px-3 py-1.5 text-[11px] font-medium bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33]"
            >
              Stop Listening
            </button>
          )}
        </div>
      </div>

      <ol className="mt-2 grid grid-cols-4 gap-1.5 list-none m-0 p-0">
        {STEPS.map((s) => {
          const active = s.id === step;
          const done = s.id < step;
          return (
            <li
              key={s.id}
              className={[
                'rounded px-2 py-1.5 text-[11px] border transition-colors',
                active
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)]/40 text-[var(--text)]'
                  : done
                    ? 'border-[var(--border)] bg-[var(--bg-panel)] text-[var(--ok)]'
                    : 'border-[var(--border)] bg-transparent text-[var(--muted)]',
              ].join(' ')}
            >
              <span className="font-semibold mr-1">{s.id}.</span>
              {s.label}
            </li>
          );
        })}
      </ol>
    </header>
  );
}
