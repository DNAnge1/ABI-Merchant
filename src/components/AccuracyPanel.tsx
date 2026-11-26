import { useEffect, useState } from 'react';
import type { AccuracyStats } from '../utils/calibrationStore';
import {
  fetchCommunityStats,
  type CommunityAggregates,
  type CommunityStats,
} from '../utils/communityVotes';

export function AccuracyPanel(props: {
  stats: AccuracyStats;
  onExport: () => void;
  onClear: () => void;
}) {
  const [community, setCommunity] = useState<CommunityStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchCommunityStats().then((stats) => {
      if (!cancelled && stats) setCommunity(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [props.stats.thumbsUp, props.stats.thumbsDown, props.stats.totalScans]);

  const agg: CommunityAggregates | null = community?.aggregates ?? null;
  const counters = community?.counters ?? {};
  const visits = counters.visits ?? 0;
  const scans = counters.scans_total ?? 0;
  const reds = counters.reds_found ?? 0;
  const showCommunity =
    community != null &&
    (visits > 0 || scans > 0 || reds > 0 || (agg?.totalVotes ?? 0) > 0);

  return (
    <section className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Accuracy stats
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={props.onExport}
            className="rounded px-2 py-1 text-[10px] font-medium bg-[var(--accent)] text-[#041412]"
          >
            Export Calibration Log (JSON)
          </button>
          <button
            type="button"
            onClick={props.onClear}
            className="rounded px-2 py-1 text-[10px] border border-[var(--border)] text-[var(--muted)]"
          >
            Clear local
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Total scans" value={String(props.stats.totalScans)} />
        <Stat label="👍 Accuracy" value={`${props.stats.accuracyPct}%`} accent />
        <Stat label="Reds found" value={String(props.stats.redsFound)} mythic />
      </div>
      {showCommunity && agg && (
        <div className="mt-2 rounded border border-[var(--border)] bg-[var(--bg)]/40 px-2 py-2">
          <div className="text-[9px] uppercase tracking-wide text-[var(--muted)] text-center mb-1.5">
            Community
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="Total Visits" value={String(visits)} compact />
            <Stat label="Total Scans" value={String(scans)} compact />
            <Stat label="Reds Found" value={String(reds)} compact mythic />
            <Stat label="Accuracy %" value={`${agg.accuracyPct}%`} compact accent />
          </div>
          {(agg.mostScanned || agg.leastScanned || agg.topRedSoundId != null) && (
            <div className="mt-1.5 text-[9px] text-center text-[var(--muted)] tabular-nums">
              {agg.mostScanned && (
                <span>
                  Most scanned #{agg.mostScanned.soundId}
                  {agg.mostScanned.scanCount != null ? ` (${agg.mostScanned.scanCount})` : ''}
                </span>
              )}
              {agg.mostScanned && agg.leastScanned && <span> · </span>}
              {agg.leastScanned && (
                <span>
                  Least #{agg.leastScanned.soundId}
                  {agg.leastScanned.scanCount != null ? ` (${agg.leastScanned.scanCount})` : ''}
                </span>
              )}
              {agg.topRedSoundId != null && (
                <span>
                  {(agg.mostScanned || agg.leastScanned) ? ' · ' : ''}
                  Top red #{agg.topRedSoundId}
                </span>
              )}
            </div>
          )}
          {agg.totalVotes > 0 && (
            <div className="mt-1 text-[9px] uppercase tracking-wide text-[var(--muted)] text-center">
              👍 {agg.totalUp} · 👎 {agg.totalDown} · {agg.totalVotes} votes
            </div>
          )}
        </div>
      )}
      <p className="m-0 mt-2 text-[10px] text-[var(--muted)]">
        Stored in localStorage (schema v1) — export JSON to refine fingerprints later or load into a
        DB. 👍/👎 only; skips counted separately ({props.stats.skips}). Community tallies sync in the
        background when the Worker is reachable.
      </p>
    </section>
  );
}

function Stat(props: {
  label: string;
  value: string;
  accent?: boolean;
  mythic?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={[
        'rounded border border-[var(--border)] bg-[var(--bg)]/50 px-2',
        props.compact ? 'py-1.5' : 'py-2',
      ].join(' ')}
    >
      <div
        className={[
          'font-bold tabular-nums',
          props.compact ? 'text-base' : 'text-lg',
          props.mythic
            ? 'text-[var(--mythic)]'
            : props.accent
              ? 'text-[var(--accent)]'
              : 'text-[var(--text)]',
        ].join(' ')}
      >
        {props.value}
      </div>
      <div className="text-[9px] uppercase tracking-wide text-[var(--muted)]">{props.label}</div>
    </div>
  );
}
