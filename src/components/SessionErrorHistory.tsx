/**
 * Collapsed-by-default session diagnostic history (Multi + Single).
 * Keeps past fail/ambiguous messages after the sticky toast clears or Multi
 * returns to “move 3×” — copyable for field reports.
 */

export interface SessionErrorEntry {
  id: string;
  ts: number;
  message: string;
}

export function SessionErrorHistory(props: {
  entries: SessionErrorEntry[];
  onClear?: () => void;
}) {
  if (props.entries.length === 0) return null;

  return (
    <details className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 group">
      <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)] [&::-webkit-details-marker]:hidden">
        <span className="font-semibold uppercase tracking-wider text-[var(--warn)]">
          Session errors · {props.entries.length}
          <span className="ml-2 font-normal normal-case tracking-normal text-[var(--muted)]">
            (expand to copy)
          </span>
        </span>
        <span className="text-[10px] text-[var(--muted)] group-open:hidden">▶</span>
        <span className="text-[10px] text-[var(--muted)] hidden group-open:inline">▼</span>
      </summary>
      <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
        <ul className="m-0 p-0 list-none space-y-1.5 max-h-48 overflow-y-auto">
          {props.entries.map((e) => (
            <li
              key={e.id}
              className="rounded border border-[var(--warn)]/30 bg-[#2a2208]/70 px-2 py-1.5 text-[11px] text-[var(--warn)] leading-relaxed whitespace-pre-wrap font-mono"
            >
              <span className="text-[10px] text-[var(--muted)] block mb-0.5">
                {formatEntryTime(e.ts)}
              </span>
              {e.message}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const text = props.entries
                .map((e) => `${formatEntryTime(e.ts)}  ${e.message}`)
                .join('\n\n');
              void navigator.clipboard?.writeText(text);
            }}
            className="rounded px-2.5 py-1 text-[11px] font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
          >
            Copy all
          </button>
          {props.onClear && (
            <button
              type="button"
              onClick={props.onClear}
              className="rounded px-2.5 py-1 text-[11px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
            >
              Clear history
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

function formatEntryTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

/** Shared play / download strip for last burst WAV (lives under Start Listening). */
export function BurstCaptureControls(props: {
  captureUrl?: string | null;
  captureDurationMs?: number;
  onPlayCapture?: () => void;
  onDownloadCapture?: () => void;
}) {
  if (!props.captureUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2">
      <p className="m-0 text-[11px] text-[var(--muted)]">
        Captured burst
        {props.captureDurationMs != null
          ? ` · ${Math.round(props.captureDurationMs)}ms`
          : ''}{' '}
        — hear whether the site got the cargo noise
      </p>
      <button
        type="button"
        onClick={props.onPlayCapture}
        className="rounded px-2.5 py-1 text-[11px] font-semibold border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10"
      >
        ▶ Play captured audio
      </button>
      <button
        type="button"
        onClick={props.onDownloadCapture}
        className="rounded px-2.5 py-1 text-[11px] font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
      >
        Download WAV
      </button>
    </div>
  );
}
