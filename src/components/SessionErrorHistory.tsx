/**
 * Session diagnostic history (Multi + Single).
 * Newest/active fail is always visible; expand shows older entries.
 * Fix → only on infra errors; ambiguous / match-fail never get Fix.
 */

import { isInfraSessionError } from '../utils/sessionErrorKind';

export interface SessionErrorEntry {
  id: string;
  ts: number;
  message: string;
}

export function SessionErrorHistory(props: {
  entries: SessionErrorEntry[];
  onClear?: () => void;
  /**
   * When true, omit the always-visible active banner (caller already shows it
   * in the Listening space). History list still includes that newest entry.
   */
  hideActiveBanner?: boolean;
  onFixInfra?: () => void;
}) {
  if (props.entries.length === 0) return null;

  const [active, ...older] = props.entries;

  return (
    <div className="space-y-2">
      {!props.hideActiveBanner && (
        <ActiveSessionError
          entry={active}
          onFixInfra={props.onFixInfra}
        />
      )}

      {older.length > 0 ? (
        <details className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 group">
          <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)] [&::-webkit-details-marker]:hidden">
            <span className="font-semibold uppercase tracking-wider text-[var(--muted)]">
              Earlier session errors · {older.length}
              <span className="ml-2 font-normal normal-case tracking-normal">
                (expand to copy)
              </span>
            </span>
            <span className="text-[10px] text-[var(--muted)] group-open:hidden">▶</span>
            <span className="text-[10px] text-[var(--muted)] hidden group-open:inline">▼</span>
          </summary>
          <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
            <ul className="m-0 p-0 list-none space-y-1.5 max-h-48 overflow-y-auto">
              {older.map((e) => (
                <li key={e.id} className="list-none">
                  <ActiveSessionError entry={e} compact onFixInfra={props.onFixInfra} />
                </li>
              ))}
            </ul>
            <HistoryActions entries={props.entries} onClear={props.onClear} />
          </div>
        </details>
      ) : (
        <HistoryActions entries={props.entries} onClear={props.onClear} compact />
      )}
    </div>
  );
}

/** Always-visible newest error. Fix → only when infra (NotReadableError / exclusive). */
export function ActiveSessionError(props: {
  entry: SessionErrorEntry;
  label?: string;
  compact?: boolean;
  onFixInfra?: () => void;
}) {
  const infra = isInfraSessionError(props.entry.message);
  return (
    <div
      role="status"
      className="rounded border border-[var(--warn)] bg-[#2a2208] px-2.5 py-2 text-[11px] text-[var(--warn)] shadow-[0_0_0_1px_rgba(245,197,66,0.2)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--mythic-gold)]">
            {props.label ?? (infra ? 'Audio setup error' : 'Active detect error')}
            <span className="ml-2 font-normal normal-case tracking-normal text-[var(--muted)]">
              {formatEntryTime(props.entry.ts)}
              {infra ? '' : ' · not a troubleshooting issue'}
            </span>
          </p>
          <p className="m-0 leading-relaxed whitespace-pre-wrap font-mono">{props.entry.message}</p>
        </div>
        {infra && props.onFixInfra && (
          <button
            type="button"
            onClick={props.onFixInfra}
            className="shrink-0 bg-transparent border-none text-[var(--accent)] text-[11px] font-semibold underline underline-offset-2 cursor-pointer"
          >
            Fix →
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryActions(props: {
  entries: SessionErrorEntry[];
  onClear?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={['flex flex-wrap gap-2', props.compact ? '' : ''].join(' ')}>
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
