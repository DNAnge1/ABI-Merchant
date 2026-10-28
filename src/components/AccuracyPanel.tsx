import type { AccuracyStats } from '../utils/calibrationStore';

export function AccuracyPanel(props: {
  stats: AccuracyStats;
  onExport: () => void;
  onClear: () => void;
}) {
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
      <p className="m-0 mt-2 text-[10px] text-[var(--muted)]">
        Stored in localStorage (schema v1) — export JSON to refine fingerprints later or load into a
        DB. 👍/👎 only; skips counted separately ({props.stats.skips}).
      </p>
    </section>
  );
}

function Stat(props: { label: string; value: string; accent?: boolean; mythic?: boolean }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg)]/50 px-2 py-2">
      <div
        className={[
          'text-lg font-bold tabular-nums',
          props.mythic ? 'text-[var(--mythic)]' : props.accent ? 'text-[var(--accent)]' : 'text-[var(--text)]',
        ].join(' ')}
      >
        {props.value}
      </div>
      <div className="text-[9px] uppercase tracking-wide text-[var(--muted)]">{props.label}</div>
    </div>
  );
}
