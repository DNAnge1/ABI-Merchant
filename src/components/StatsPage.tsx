/**
 * Dedicated Stats view — local accuracy + community counters.
 * Opened from footer or WIP popup; keep out of Catch HUD chrome.
 */

import { AccuracyPanel } from './AccuracyPanel';
import type { AccuracyStats } from '../utils/calibrationStore';

export function StatsPage(props: {
  stats: AccuracyStats;
  onBack: () => void;
  onExport: () => void;
  onClear: () => void;
  onOpenSuggestions?: () => void;
}) {
  return (
    <div className="max-w-[720px] mx-auto flex flex-col gap-4" data-stats-page>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-2xl font-medium tracking-tight">Stats</h2>
          <p className="m-0 mt-1 text-[13px] text-[var(--muted)]">
            Local 👍/👎 accuracy plus community counters when the Worker is reachable.
          </p>
        </div>
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
        >
          ← Back
        </button>
      </div>

      <AccuracyPanel
        stats={props.stats}
        onExport={props.onExport}
        onClear={props.onClear}
      />

      {props.onOpenSuggestions && (
        <p className="m-0 text-[12px] text-[var(--muted)]">
          Have an idea?{' '}
          <button
            type="button"
            onClick={props.onOpenSuggestions}
            className="bg-transparent border-none p-0 text-[var(--accent)] underline underline-offset-2 cursor-pointer"
          >
            Open Suggestions
          </button>
        </p>
      )}
    </div>
  );
}
