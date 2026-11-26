/**
 * Calibration / Confusion Debug Panel (Advanced).
 * Normal miss flow is post-stop “Report issue” — this panel is for power users
 * who want live onset logging + Copy Debug JSON while recording.
 * Collapsed accordion by default; expand on demand.
 */

import { useMemo, useState } from 'react';
import type { ConfusionDebugEvent, ConfusionPairSummary } from '../utils/confusionDebug';
import {
  copyTextToClipboard,
  downloadBlob,
  exportConfusionDebugJson,
} from '../utils/confusionDebug';
import { topNeighbors } from '../utils/fingerprintPairwise';
import type { FingerprintsFile } from '../utils/audioMatcher';

const EMPTY_COPY_MESSAGE =
  'No calibration entries yet. Steps: (1) set Actual Sound ID, (2) Start Moving / click cargo so rows appear, (3) Copy Debug JSON anytime — even while listening.';

export function CalibrationDebugPanel(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundIds: number[];
  expectedId: number | null;
  onExpectedId: (id: number | null) => void;
  events: ConfusionDebugEvent[];
  summary: ConfusionPairSummary[];
  sessionId: string;
  fingerprints: FingerprintsFile;
  /** Capture is live (listening / capturing). */
  listening: boolean;
  /** Burst move is active — onsets are actually being appended. */
  loggingActive?: boolean;
  clipBlobs: Record<string, Blob>;
  onClear: () => void;
  /** Optional Worker auto-save (numbers-only; never WAV). */
  autoSave?: boolean;
  onAutoSaveChange?: (on: boolean) => void;
  autoSaveStatus?: 'idle' | 'saving' | 'ok' | 'err';
}) {
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const neighbors = useMemo(() => {
    if (props.expectedId == null) return [];
    return topNeighbors(props.fingerprints, props.expectedId, 5);
  }, [props.expectedId, props.fingerprints]);

  const hasEvents = props.events.length > 0;
  const json = exportConfusionDebugJson(props.sessionId, props.expectedId, props.events);
  const logging = Boolean(props.loggingActive);
  const listeningOnly = props.listening && !logging;
  const burstRows = props.events.filter((e) => e.source === 'burst' || e.source === 'auto');
  const liveRows = props.events.filter((e) => e.source === 'live-onset');

  async function handleCopy() {
    if (!hasEvents) {
      const ok = await copyTextToClipboard(EMPTY_COPY_MESSAGE);
      setCopied(ok);
      setCopyHint(
        ok
          ? 'Copied empty-state tip — no rows logged yet.'
          : 'Could not copy — check clipboard permission.',
      );
      window.setTimeout(() => {
        setCopied(false);
        setCopyHint(null);
      }, 2200);
      return;
    }
    const ok = await copyTextToClipboard(json);
    setCopied(ok);
    setCopyHint(ok ? null : 'Could not copy — check clipboard permission.');
    window.setTimeout(() => {
      setCopied(false);
      setCopyHint(null);
    }, 1600);
  }

  function handleDownload() {
    if (!hasEvents) {
      setCopyHint('Nothing to download yet — Start Moving / click cargo so entries appear.');
      window.setTimeout(() => setCopyHint(null), 2200);
      return;
    }
    downloadBlob(
      new Blob([json], { type: 'application/json' }),
      `abi-merchant-confusion-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }

  return (
    <details
      className={[
        'rounded border bg-[var(--bg-panel)]',
        props.open ? 'border-[var(--warn)]/40' : 'border-[var(--border)]',
      ].join(' ')}
      open={props.open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (next !== props.open) props.onOpenChange(next);
      }}
      data-calibration-debug={props.open ? 'open' : 'collapsed'}
    >
      <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px] [&::-webkit-details-marker]:hidden">
        <span
          className={[
            'font-semibold uppercase tracking-wider',
            props.open ? 'text-[var(--warn)]' : 'text-[var(--muted)]',
          ].join(' ')}
        >
          Advanced · live onset log
        </span>
        <span className="text-[10px] text-[var(--muted)] tabular-nums">
          {hasEvents
            ? `${props.events.length} logged${liveRows.length ? ` · ${liveRows.length} live` : ''}${
                burstRows.length ? ` · ${burstRows.length} stop` : ''
              }`
            : 'Collapsed · expand if needed'}
          <span className="ml-2 opacity-70">{props.open ? '▲' : '▼'}</span>
        </span>
      </summary>

      <div className="px-3 pb-3 space-y-3 border-t border-[var(--border)]/60">
        <p className="m-0 mt-2 text-[11px] text-[var(--muted)] leading-snug">
          Prefer the simple path after Stop:{' '}
          <strong className="text-[var(--text)]">Report issue</strong> → pick the real item → Send
          (numbers only; WAV stays on your device). This panel is optional live logging while you
          drag cargo. <strong className="text-[var(--text)]">Pred</strong> follows the Live
          narrowing consensus (HUD), not a raw flicker; Stop rows use the final lock.
        </p>

        <ol className="m-0 pl-4 space-y-1 text-[11px] text-[var(--muted)] leading-snug">
          <li>
            Set <span className="text-[var(--text)] font-semibold">Actual Sound ID</span> (what you
            are clicking).
          </li>
          <li>
            <span className="text-[var(--text)] font-semibold">Start Moving</span> / click cargo —
            rows appear below.
          </li>
          <li>
            <span className="text-[var(--text)] font-semibold">Copy Debug JSON anytime</span> (even
            mid-listen). Empty log copies a tip, never a silent gray button.
          </li>
        </ol>

        {props.onAutoSaveChange && (
          <label className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={Boolean(props.autoSave)}
              onChange={(e) => props.onAutoSaveChange?.(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>
              Auto-save to Worker{' '}
              <span className="text-[10px]">(numbers-only public miss reports — no audio)</span>
            </span>
            {props.autoSave && props.autoSaveStatus === 'ok' && (
              <span className="text-[var(--accent)] text-[10px]">synced</span>
            )}
            {props.autoSave && props.autoSaveStatus === 'err' && (
              <span className="text-[var(--warn)] text-[10px]">offline / rate-limited</span>
            )}
            {props.autoSave && props.autoSaveStatus === 'saving' && (
              <span className="text-[10px]">saving…</span>
            )}
          </label>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="font-semibold text-[var(--muted)] uppercase tracking-wide">
              Actual Sound ID
            </span>
            <select
              value={props.expectedId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                props.onExpectedId(v === '' ? null : Number(v));
              }}
              className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text)] min-w-[7rem]"
            >
              <option value="">— pick —</option>
              {props.soundIds.map((id) => (
                <option key={id} value={id}>
                  #{id}
                </option>
              ))}
            </select>
          </label>
          <div className="text-[11px] text-[var(--muted)] pb-1.5 max-w-sm">
            {logging ? (
              <span className="text-[var(--listening)] font-semibold">
                Recording — logging clean onsets
              </span>
            ) : listeningOnly ? (
              <span className="text-[var(--warn)]">
                Listening, but not logging yet — press Start Moving / Arm Multi, then click cargo
              </span>
            ) : props.expectedId == null ? (
              <span>Pick Actual Sound ID, then Start Moving to log</span>
            ) : (
              <span>Ready — Start Moving / click cargo to log</span>
            )}
            {hasEvents && (
              <span className="ml-2 tabular-nums">· {props.events.length} logged</span>
            )}
          </div>
        </div>

        {props.expectedId != null && neighbors.length > 0 && (
          <div className="text-[11px] text-[var(--muted)] leading-snug">
            <span className="font-semibold text-[var(--text)]">
              FP neighbors of #{props.expectedId}:{' '}
            </span>
            {neighbors.map((n, i) => (
              <span key={n.soundId}>
                {i > 0 ? ', ' : ''}#{n.soundId}={n.cosine.toFixed(3)}
              </span>
            ))}
          </div>
        )}

        {props.summary.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
              Live confusion summary
            </div>
            <div className="flex flex-wrap gap-1.5">
              {props.summary.map((s) => (
                <span
                  key={s.label}
                  className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-mono tabular-nums text-[var(--text)]"
                >
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {!hasEvents && (
          <div
            className="rounded border border-dashed border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]"
            data-calibration-empty
          >
            No entries yet. After Actual ID + Start Moving, each clean cargo click adds a row. Copy
            still works now (copies a tip). Wrong lock after Stop? Use{' '}
            <span className="text-[var(--text)] font-semibold">Report issue</span> on the result —
            no need for this panel.
          </div>
        )}

        {hasEvents && (
          <div className="max-h-48 overflow-auto rounded border border-[var(--border)]">
            <table className="w-full text-[10px] border-collapse">
              <thead className="sticky top-0 bg-[var(--bg-elevated)] text-[var(--muted)]">
                <tr>
                  <th className="text-left font-semibold px-2 py-1">Src</th>
                  <th className="text-left font-semibold px-2 py-1">Exp</th>
                  <th
                    className="text-left font-semibold px-2 py-1"
                    title="HUD consensus for live rows; Stop & Match lock for burst/auto"
                  >
                    Pred
                  </th>
                  <th className="text-left font-semibold px-2 py-1">OK</th>
                  <th className="text-left font-semibold px-2 py-1">Exp rank</th>
                  <th className="text-left font-semibold px-2 py-1">Top 5 (raw)</th>
                  <th className="text-left font-semibold px-2 py-1">Clip</th>
                </tr>
              </thead>
              <tbody>
                {[...props.events].reverse().map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    clip={e.clipId ? props.clipBlobs[e.clipId] : undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-dim)]/20"
            title={
              hasEvents
                ? 'Copy numbers-only Debug JSON'
                : 'Always enabled — copies an empty-state tip when no rows exist'
            }
          >
            {copied ? 'Copied' : 'Copy Debug JSON'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className={[
              'rounded-lg px-3 py-1.5 text-[11px] font-semibold border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-elevated)]',
              !hasEvents ? 'opacity-70' : '',
            ].join(' ')}
            title={hasEvents ? 'Download numbers-only JSON' : 'Enabled once at least one row is logged'}
          >
            Download JSON
          </button>
          <button
            type="button"
            disabled={!hasEvents}
            onClick={props.onClear}
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--warn)] disabled:opacity-40"
          >
            Clear log
          </button>
          {copyHint && (
            <span className="text-[10px] text-[var(--muted)]" role="status">
              {copyHint}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

function sourceLabel(source: ConfusionDebugEvent['source']): string {
  if (source === 'live-onset') return 'live';
  if (source === 'burst') return 'stop';
  if (source === 'auto') return 'auto';
  if (source === 'player-miss') return 'report';
  return source;
}

function EventRow(props: { event: ConfusionDebugEvent; clip?: Blob }) {
  const e = props.event;
  const top = e.top5.map((r) => `#${r.soundId}:${r.confidence}`).join(' ');
  const rawTop = e.top5[0]?.soundId;
  const predDiffers = rawTop != null && rawTop !== e.predictedId;
  return (
    <tr className="border-t border-[var(--border)] align-top">
      <td className="px-2 py-1 text-[var(--muted)] uppercase tracking-wide">{sourceLabel(e.source)}</td>
      <td className="px-2 py-1 tabular-nums">#{e.expectedId}</td>
      <td className="px-2 py-1 tabular-nums" title={predDiffers ? `Raw peek top was #${rawTop}` : undefined}>
        #{e.predictedId}
        {predDiffers && (
          <span className="ml-1 text-[9px] text-[var(--muted)]">(raw #{rawTop})</span>
        )}
      </td>
      <td className="px-2 py-1">{e.match ? '✓' : '✗'}</td>
      <td className="px-2 py-1 tabular-nums">
        {e.expectedRank != null ? `${e.expectedRank} @ ${e.expectedScore}%` : '—'}
      </td>
      <td className="px-2 py-1 font-mono text-[9px] text-[var(--muted)] max-w-[14rem] truncate" title={top}>
        {top}
      </td>
      <td className="px-2 py-1">
        {props.clip ? (
          <button
            type="button"
            className="text-[var(--accent)] underline text-[10px]"
            title="Local Download Clip WAV — not uploaded"
            onClick={() =>
              downloadBlob(
                props.clip!,
                `clip-exp${e.expectedId}-pred${e.predictedId}-${e.id}.wav`,
              )
            }
          >
            WAV
          </button>
        ) : (
          <span className="text-[var(--muted)]" title="No local clip for this row">
            —
          </span>
        )}
      </td>
    </tr>
  );
}
