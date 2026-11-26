/**
 * Short recommended capture settings — teal setup panel, not a gold clone.
 */
export function RecommendedAudioSettings(props: { compact?: boolean }) {
  const items = [
    {
      title: 'Share the game window',
      body: 'In Chrome/Edge, pick the Arena Breakout: Infinite window (not the whole desktop) and enable Share audio.',
    },
    {
      title: 'Disable virtual surround',
      body: 'Turn off SteelSeries Sonar, Razer THX, Dolby Atmos, and Windows Sonic for the game output — they smear cargo clicks.',
    },
    {
      title: 'Volume 80–100%',
      body: 'Keep game SFX audible. Exclusive-mode devices: Win+R → mmsys.cpl → Playback → Properties → Advanced → uncheck exclusive control.',
    },
    {
      title: 'Hover, then drag',
      body: 'Avoid rapid double-clicks. Hover the cargo, then click-drag smoothly so the pickup onset is clean.',
    },
  ];

  return (
    <section
      className={[
        'rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]',
        props.compact ? 'p-2.5' : 'p-3',
      ].join(' ')}
      data-recommended-audio
    >
      <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        Recommended audio settings
      </h2>
      <ul className="m-0 mt-2 p-0 list-none grid gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.title} className="min-w-0">
            <div className="text-[12px] font-semibold text-[var(--accent)]">{it.title}</div>
            <p className="m-0 mt-0.5 text-[11px] text-[var(--muted)] leading-snug">{it.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
