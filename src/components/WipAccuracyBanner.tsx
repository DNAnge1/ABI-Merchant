/**
 * Standing work-in-progress notice — teal/dark, honest, not alarming.
 * Shown on main surfaces so field testers know matches may still drift.
 */
export function WipAccuracyBanner(props: { prominent?: boolean }) {
  const prominent = props.prominent === true;
  return (
    <div
      role="status"
      className={[
        'rounded-lg border text-center',
        prominent
          ? 'border-[var(--accent)]/70 bg-[var(--accent-dim)]/40 px-4 py-3'
          : 'border-[var(--accent)]/45 bg-[var(--accent-dim)]/25 px-3 py-2.5',
      ].join(' ')}
    >
      <p
        className={[
          'm-0 font-semibold uppercase tracking-wider text-[var(--accent)]',
          prominent ? 'text-[12px]' : 'text-[11px]',
        ].join(' ')}
      >
        Work in progress
      </p>
      <p
        className={[
          'm-0 mt-1 leading-relaxed text-[var(--text)]',
          prominent ? 'text-[13px]' : 'text-[12px]',
        ].join(' ')}
      >
        Results may not be completely accurate yet — we’re still tuning matching from field
        captures. Report misses when you can; thanks for testing.
      </p>
    </div>
  );
}
