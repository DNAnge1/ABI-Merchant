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
  if (!hasCargo) return { step: 1, detail: 'Select size & price on the grid' };
  switch (status) {
    case 'idle':
      return { step: 1, detail: 'Start capture to listen for pickups' };
    case 'listening':
      return { step: 2, detail: detail || 'Listening…' };
    case 'capturing':
      return { step: 3, detail: detail || 'Checking Sound…' };
    case 'matching':
      return { step: 3, detail: detail || 'Matching…' };
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
  onStart: () => void;
  onStop: () => void;
}) {
  const { step, detail } = stepFromStatus(props.status, props.hasCargo, props.detail);

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/90 backdrop-blur-sm px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-sm font-semibold tracking-wide text-[var(--accent)] m-0">
              ABI Field Merchant
            </h1>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
              Audio & Grid Scanner
            </span>
          </div>
          <p className="m-0 mt-0.5 text-xs text-[var(--muted)] truncate">{detail}</p>
        </div>

        <div className="flex items-center gap-2">
          {!props.capturing ? (
            <button
              type="button"
              onClick={props.onStart}
              className="rounded px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-[#041412] hover:brightness-110"
            >
              Share game audio
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onStop}
              className="rounded px-3 py-1.5 text-xs font-medium bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33] hover:bg-[#4a2830]"
            >
              Stop capture
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
