/**
 * Standing work-in-progress notice — prominent teal/dark, not alarming.
 * Shown on main surfaces so field testers know matches may still drift.
 */
export function WipAccuracyBanner() {
  return (
    <div
      role="status"
      className="rounded-lg border border-[var(--accent)]/45 bg-[var(--accent-dim)]/25 px-3 py-2.5 text-center"
    >
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
        Work in progress
      </p>
      <p className="m-0 mt-1 text-[12px] leading-relaxed text-[var(--text)]">
        Matching may not be completely accurate yet — we’re still tuning from field captures.
        Report misses when you can; thanks for testing.
      </p>
    </div>
  );
}
