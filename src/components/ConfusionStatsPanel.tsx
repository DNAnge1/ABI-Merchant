/**
 * Public Community confusion stats — Top Misidentified + daily trends.
 * Numbers-only reports from Worker; no audio. Soft-fail when offline.
 */

import { useEffect, useState } from 'react';
import {
  fetchMissReportStats,
  type MissConfusionPair,
  type MissDailyRow,
  type MissReportStats,
} from '../utils/missReportsApi';

export function ConfusionStatsPanel() {
  const [stats, setStats] = useState<MissReportStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMissReportStats().then((s) => {
      if (!cancelled) {
        setStats(s);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return (
      <section
        className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-3"
        data-confusion-stats="loading"
      >
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Community confusion
        </h2>
        <p className="m-0 mt-2 text-[11px] text-[var(--muted)]">Loading public miss reports…</p>
      </section>
    );
  }

  if (!stats) {
    return (
      <section
        className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-3"
        data-confusion-stats="offline"
      >
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Community confusion
        </h2>
        <p className="m-0 mt-2 text-[11px] text-[var(--muted)]">
          Worker unreachable — Top Misidentified / trends appear when online. Local 👎 still
          logs full diagnostics on-device (numbers only; no audio upload).
        </p>
      </section>
    );
  }

  const { totals, topMisidentified, daily, topPredictedAsWrong } = stats;
  const hasData = totals.total > 0;

  return (
    <section
      className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-3 space-y-3"
      data-confusion-stats="ready"
    >
      <div>
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Community confusion
        </h2>
        <p className="m-0 mt-1 text-[11px] text-[var(--muted)] leading-snug">
          Public Top Misidentified from Report issue + optional calibration auto-save. Numbers-only
          diagnostics — never audio.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Reports" value={String(totals.total)} />
        <MiniStat label="Misses" value={String(totals.misses)} warn />
        <MiniStat label="Hits" value={String(totals.hits)} accent />
      </div>

      {!hasData ? (
        <p className="m-0 text-[11px] text-[var(--muted)]">
          No community miss reports yet — be the first: after Stop, tap Report issue and pick what
          you actually got.
        </p>
      ) : (
        <>
          <TopMisidentified pairs={topMisidentified} />
          {topPredictedAsWrong.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1.5">
                Most often predicted wrong
              </div>
              <div className="flex flex-wrap gap-1.5">
                {topPredictedAsWrong.map((r) => (
                  <span
                    key={r.soundId}
                    className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-mono tabular-nums"
                  >
                    #{r.soundId} ×{r.hits}
                  </span>
                ))}
              </div>
            </div>
          )}
          <ConfusionTrend daily={daily} windowDays={stats.windowDays} />
        </>
      )}
    </section>
  );
}

function MiniStat(props: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg)]/50 px-2 py-1.5">
      <div
        className={[
          'text-base font-bold tabular-nums',
          props.warn
            ? 'text-[var(--warn)]'
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

function TopMisidentified(props: { pairs: MissConfusionPair[] }) {
  if (props.pairs.length === 0) {
    return (
      <p className="m-0 text-[11px] text-[var(--muted)]">No confusion pairs yet (all hits).</p>
    );
  }
  const max = Math.max(...props.pairs.map((p) => p.hits), 1);
  return (
    <div data-top-misidentified>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1.5">
        Top Misidentified
      </div>
      <ul className="m-0 p-0 list-none space-y-1.5">
        {props.pairs.map((p) => {
          const pct = Math.round((p.hits / max) * 100);
          return (
            <li key={p.label} className="flex items-center gap-2 text-[11px]">
              <span className="w-[7.5rem] shrink-0 font-mono tabular-nums text-[var(--text)]">
                {p.label}
              </span>
              <div className="flex-1 h-2 rounded bg-[var(--bg)] overflow-hidden border border-[var(--border)]">
                <div
                  className="h-full rounded bg-[var(--warn)]/70"
                  style={{ width: `${pct}%` }}
                  title={`${p.hits} reports`}
                />
              </div>
              <span className="w-8 text-right tabular-nums text-[var(--muted)]">{p.hits}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfusionTrend(props: { daily: MissDailyRow[]; windowDays: number }) {
  if (props.daily.length === 0) {
    return null;
  }
  const max = Math.max(...props.daily.map((d) => Math.max(d.misses, d.total)), 1);
  const w = 320;
  const h = 72;
  const pad = 4;
  const n = props.daily.length;
  const barW = Math.max(2, (w - pad * 2) / Math.max(n, 1) - 2);

  return (
    <div data-confusion-trend>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1.5">
        Confusion trends ({props.windowDays}d)
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full max-w-md h-auto block"
        role="img"
        aria-label="Daily miss report counts"
      >
        {props.daily.map((d, i) => {
          const x = pad + i * ((w - pad * 2) / n);
          const missH = Math.max(1, (d.misses / max) * (h - pad * 2 - 12));
          const totalH = Math.max(missH, (d.total / max) * (h - pad * 2 - 12));
          const yMiss = h - pad - 12 - missH;
          const yTotal = h - pad - 12 - totalH;
          return (
            <g key={d.day}>
              <rect
                x={x}
                y={yTotal}
                width={barW}
                height={totalH}
                fill="var(--accent)"
                opacity={0.35}
              />
              <rect
                x={x}
                y={yMiss}
                width={barW}
                height={missH}
                fill="var(--warn)"
                opacity={0.85}
              />
              {i % Math.max(1, Math.ceil(n / 6)) === 0 && (
                <text
                  x={x + barW / 2}
                  y={h - 2}
                  textAnchor="middle"
                  fontSize={7}
                  fill="var(--muted)"
                >
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="m-0 mt-1 text-[9px] text-[var(--muted)]">
        <span className="text-[var(--warn)]">■</span> misses{' '}
        <span className="text-[var(--accent)] ml-2">■</span> all reports
      </p>
    </div>
  );
}
