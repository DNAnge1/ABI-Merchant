/**
 * Short recommended capture settings — teal setup panel, not a gold clone.
 * Catch HUD: single button → modal (no nested drawers).
 */

import { useEffect, useState } from 'react';

const ITEMS = [
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

function TipsBody() {
  return (
    <ul className="m-0 p-0 list-none grid gap-2 sm:grid-cols-2">
      {ITEMS.map((it) => (
        <li key={it.title} className="min-w-0">
          <div className="text-[12px] font-semibold text-[var(--accent)]">{it.title}</div>
          <p className="m-0 mt-0.5 text-[11px] text-[var(--muted)] leading-snug">{it.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Button under the Listening circle → modal with the same tips. */
export function RecommendedAudioButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 text-[11px] font-semibold text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        data-recommended-audio="button"
      >
        Recommended audio settings
      </button>
      <RecommendedAudioModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function RecommendedAudioModal(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Recommended audio settings"
      data-recommended-audio-modal
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 border-none cursor-pointer"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="m-0 text-[15px] font-semibold text-[var(--text)]">
            Recommended audio settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-[11px] text-[var(--muted)] border border-[var(--border)]"
          >
            Close
          </button>
        </div>
        <TipsBody />
      </div>
    </div>
  );
}

/** Inline panel (wizard / manual). Catch HUD uses {@link RecommendedAudioButton}. */
export function RecommendedAudioSettings(props: { compact?: boolean }) {
  if (props.compact) {
    return <RecommendedAudioButton />;
  }

  return (
    <section
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3"
      data-recommended-audio
    >
      <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        Recommended audio settings
      </h2>
      <div className="mt-2">
        <TipsBody />
      </div>
    </section>
  );
}
