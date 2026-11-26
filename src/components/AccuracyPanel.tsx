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
      <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        Accuracy stats
      </h2>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Total scans" value={String(props.stats.totalScans)} />
        <Stat label="👍 Accuracy" value={`${props.stats.accuracyPct}%`} accent />
        <Stat label="Reds found" value={String(props.stats.redsFound)} mythic />
      </div>
      {showCommunity && agg && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <Stat label="Visits" value={String(visits)} compact />
          <Stat label="Community scans" value={String(scans)} compact />
          <Stat label="Reds" value={String(reds)} compact mythic />
          <Stat label="Community %" value={`${agg.accuracyPct}%`} compact accent />
        </div>
      )}
      <details className="mt-2 rounded border border-[var(--border)] bg-[var(--bg)]/40 px-2.5 py-1.5">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Export & details ▾
        </summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
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
          {showCommunity && agg && (agg.mostScanned || agg.leastScanned || agg.topRedSoundId != null) && (
            <p className="m-0 text-[9px] text-[var(--muted)] tabular-nums">
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
              {agg.totalVotes > 0 && (
                <span>
                  {' '}
                  · 👍 {agg.totalUp} · 👎 {agg.totalDown}
                </span>
              )}
            </p>
          )}
          <p className="m-0 text-[10px] text-[var(--muted)]">
            localStorage schema v1 — export JSON to refine fingerprints. Skips: {props.stats.skips}.
            Community tallies sync when the Worker is reachable.
          </p>
        </div>
      </details>
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
