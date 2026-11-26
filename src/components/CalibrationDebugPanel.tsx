/**
 * Phase 1 Calibration / Confusion Debug Panel.
 * Progressive disclosure (Advanced Settings) — not a secret flag.
 * Ground-truth Sound ID + live onset confusion logger.
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
  listening: boolean;
  clipBlobs: Record<string, Blob>;
  onClear: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const neighbors = useMemo(() => {
    if (props.expectedId == null) return [];
    return topNeighbors(props.fingerprints, props.expectedId, 5);
  }, [props.expectedId, props.fingerprints]);

  if (!props.open) {
    return (
      <details
        className="rounded border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2"
        data-calibration-debug="collapsed"
      >
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] [&::-webkit-details-marker]:hidden">
          <span className="font-semibold uppercase tracking-wider text-[var(--muted)]">
            Calibration / Confusion
          </span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[10px] font-semibold border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent-dim)]/20"
            onClick={(e) => {
              e.preventDefault();
              props.onOpenChange(true);
            }}
          >
            Open panel
          </button>
        </summary>
      </details>
    );
  }

  const json = exportConfusionDebugJson(props.sessionId, props.expectedId, props.events);

  return (
    <section
      className="rounded border border-[var(--warn)]/40 bg-[var(--bg-panel)] p-3 space-y-3"
      data-calibration-debug="open"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--warn)]">
            Calibration / Confusion
          </h2>
          <p className="m-0 mt-1 text-[11px] text-[var(--muted)] leading-snug">
            Pick the Sound ID you are actually clicking. Every clean onset logs expected vs
            predicted (top 5 + expected rank, diagnostics, map/mode). Copy Debug JSON is
            numbers-only — Download Clip WAV stays on your device (never uploaded). Known
            collisions: #2→#8, #8→#20/#7.
          </p>
        </div>
        <button
          type="button"
          className="text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
          onClick={() => props.onOpenChange(false)}
        >
          Collapse
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-semibold text-[var(--muted)] uppercase tracking-wide">
            Ground-truth Sound ID
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
        <div className="text-[11px] text-[var(--muted)] pb-1.5">
          {props.listening ? (
            <span className="text-[var(--listening)] font-semibold">Listening — logging onsets</span>
          ) : (
            <span>Start Moving / listen to log</span>
          )}
          {props.events.length > 0 && (
            <span className="ml-2 tabular-nums">· {props.events.length} logged</span>
          )}
        </div>
      </div>

      {props.expectedId != null && neighbors.length > 0 && (
        <div className="text-[11px] text-[var(--muted)] leading-snug">
          <span className="font-semibold text-[var(--text)]">FP neighbors of #{props.expectedId}: </span>
          {neighbors.map((n, i) => (
            <span key={n.soundId}>
              {i > 0 ? ', ' : ''}
              #{n.soundId}={n.cosine.toFixed(3)}
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

      {props.events.length > 0 && (
        <div className="max-h-48 overflow-auto rounded border border-[var(--border)]">
          <table className="w-full text-[10px] border-collapse">
            <thead className="sticky top-0 bg-[var(--bg-elevated)] text-[var(--muted)]">
              <tr>
                <th className="text-left font-semibold px-2 py-1">Exp</th>
                <th className="text-left font-semibold px-2 py-1">Pred</th>
                <th className="text-left font-semibold px-2 py-1">OK</th>
                <th className="text-left font-semibold px-2 py-1">Exp rank</th>
                <th className="text-left font-semibold px-2 py-1">Top 5</th>
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.events.length === 0}
          onClick={async () => {
            const ok = await copyTextToClipboard(json);
            setCopied(ok);
            window.setTimeout(() => setCopied(false), 1600);
          }}
          className="rounded-lg px-3 py-1.5 text-[11px] font-semibold border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-dim)]/20 disabled:opacity-40"
        >
          {copied ? 'Copied' : 'Copy Debug JSON'}
        </button>
        <button
          type="button"
          disabled={props.events.length === 0}
          onClick={() => {
            downloadBlob(
              new Blob([json], { type: 'application/json' }),
              `abi-merchant-confusion-${new Date().toISOString().slice(0, 10)}.json`,
            );
          }}
          className="rounded-lg px-3 py-1.5 text-[11px] font-semibold border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          Download JSON
        </button>
        <button
          type="button"
          disabled={props.events.length === 0}
          onClick={props.onClear}
          className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--warn)] disabled:opacity-40"
        >
          Clear log
        </button>
      </div>
    </section>
  );
}

function EventRow(props: { event: ConfusionDebugEvent; clip?: Blob }) {
  const e = props.event;
  const top = e.top5.map((r) => `#${r.soundId}:${r.confidence}`).join(' ');
  return (
    <tr className="border-t border-[var(--border)] align-top">
      <td className="px-2 py-1 tabular-nums">#{e.expectedId}</td>
      <td className="px-2 py-1 tabular-nums">#{e.predictedId}</td>
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
