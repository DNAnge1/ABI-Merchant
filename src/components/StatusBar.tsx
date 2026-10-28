import type { MatcherStatus } from '../utils/audioMatcher';

const STEPS = [
  { id: 1, label: 'Select Cargo' },
  { id: 2, label: 'Listening' },
  { id: 3, label: 'Drag Cargo' },
  { id: 4, label: 'Match Ready' },
] as const;

function stepFromStatus(
  status: MatcherStatus,
  hasCargo: boolean,
  detail?: string,
): { step: number; detail: string } {
  if (!hasCargo) return { step: 1, detail: 'Select size & price for the Mystery Cargo box' };
  switch (status) {
    case 'idle':
      return { step: 1, detail: 'Click Start Listening, then share the game window with audio' };
    case 'listening':
      return { step: 2, detail: detail || 'Listening… grab or drag the cargo in-game' };
    case 'capturing':
      return { step: 3, detail: detail || 'Checking Sound…' };
    case 'matching':
      return { step: 3, detail: detail || 'Matching Sound ID…' };
    case 'done':
      return { step: 4, detail: detail || 'Done' };
    case 'error':
      return { step: 1, detail: detail || 'Error' };
    default:
      return { step: 1, detail: '' };
  }
}

export function StatusBar(props: {
  status: MatcherStatus;
  hasCargo: boolean;
  detail?: string;
  capturing: boolean;
  redPct?: number | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const { step, detail } = stepFromStatus(props.status, props.hasCargo, props.detail);

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/90 backdrop-blur-sm px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-sm font-semibold tracking-wide text-[var(--accent)] m-0">
              ABI Field Merchant
            </h1>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Audio & Grid Scanner
            </span>
            {props.redPct != null && props.status === 'done' && (
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

        <div className="flex items-center gap-2">
          {!props.capturing ? (
            <button
              type="button"
              onClick={props.onStart}
              className="rounded px-3 py-2 text-xs font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110 shadow-[0_0_20px_rgba(61,214,198,0.25)]"
            >
              Start Listening — Capture Game Audio
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onStop}
              className="rounded px-3 py-2 text-xs font-medium bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33] hover:bg-[#4a2830]"
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
