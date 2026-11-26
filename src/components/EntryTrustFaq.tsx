/**
 * Entry-only trust FAQ. Keep off Catch / Listen HUD.
 * Compact: FAQ button opens a modal; exclusive accordion (all closed by default).
 */

import { useEffect, useState, type ReactNode } from 'react';

const GITHUB_REPO = 'https://github.com/DNAnge1/ABI-Merchant';

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Is this legit? What about ToS / bans?',
    a: (
      <>
        This is an independent fan companion that runs only in your browser. It never installs a
        game mod, never injects into the client, and never touches game memory or network traffic —
        it only listens to audio you choose to share (or a mic/loopback path you pick). We are{' '}
        <strong className="font-semibold text-[var(--text)]">not</strong> an official partner and
        cannot promise how publisher policies treat external helpers. Other community passive-audio
        tools have confirmed listen-only browser helpers (no install, no inject) as a pattern
        players have used without a known ban wave from audio listening alone — still shared
        experience, not a ban guarantee for you or this project. Use at your own discretion;
        game Terms of Service and enforcement can change without notice.
      </>
    ),
  },
  {
    q: 'Do I need to download or install anything?',
    a: (
      <>
        No. Open the GitHub Pages site in Chrome or Edge — no .exe, no launcher, no browser
        extension. Optional Windows loopback (VB-Cable / Stereo Mix) is only if screen-share audio
        fails on your setup.
      </>
    ),
  },
  {
    q: 'Where does game audio go?',
    a: (
      <>
        Matching runs on your device. Shared display/mic audio is processed in the browser for
        fingerprint comparison and is <strong className="font-semibold text-[var(--text)]">never
        uploaded</strong> as recordings or WAV clips. Optional community 👍/👎 tallies, Suggestions
        text, and public miss / confusion reports (numbers-only: top 5 scores, expected rank,
        onset/RMS, map/mode) go to a Cloudflare Worker when online — never your audio stream.
        Calibration “Download Clip WAV” stays on your device only.
      </>
    ),
  },
  {
    q: 'Is the code open source?',
    a: (
      <>
        Yes. The app and Worker live on GitHub:{' '}
        <a
          href={GITHUB_REPO}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          DNAnge1/ABI-Merchant
        </a>
        . You can read every line, open issues, or fork.
      </>
    ),
  },
  {
    q: 'Is this ABI Builder / Merchant Helper?',
    a: (
      <>
        No. Unaffiliated fan project. Catalog/explorer data may credit the public merchant pages;
        this UI, matcher, and calibration loop are separate. Footer links stay honest about that.
      </>
    ),
  },
];

/** One-line trust strip for Entry CTA (also exported for reuse). */
export function EntryTrustStrip() {
  return (
    <p
      className="m-0 text-center text-[10px] sm:text-[11px] font-medium tracking-wide text-[var(--muted)] leading-relaxed"
      data-entry-trust-strip
    >
      <span className="text-[var(--text)]/80">No Download</span>
      <span className="mx-1.5 text-[var(--border)]" aria-hidden>
        ·
      </span>
      <span className="text-[var(--text)]/80">100% Local in Browser</span>
      <span className="mx-1.5 text-[var(--border)]" aria-hidden>
        ·
      </span>
      <span className="text-[var(--text)]/80">Open Source</span>
      <span className="mx-1.5 text-[var(--border)]" aria-hidden>
        ·
      </span>
      <span className="text-[var(--text)]/80">Game Audio Only</span>
    </p>
  );
}

/** Compact Entry trigger — opens FAQ in a modal so the first viewport stays short. */
export function EntryTrustFaq() {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full max-w-md mx-auto text-center" data-entry-trust-faq>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]/80 px-4 py-2 text-[12px] font-semibold text-[var(--text)] hover:border-[var(--accent)]/50"
      >
        Trust &amp; safety FAQ
      </button>
      <FaqModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function FaqModal(props: { open: boolean; onClose: () => void }) {
  /** Exclusive accordion — null means all closed. */
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const { open, onClose } = props;
  useEffect(() => {
    if (!open) {
      setOpenIndex(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Trust and safety FAQ"
      data-faq-modal
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 border-none cursor-pointer"
        aria-label="Close FAQ"
        onClick={props.onClose}
      />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2.5">
          <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            Trust &amp; safety FAQ
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded px-2 py-1 text-[11px] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--text)]"
          >
            Close
          </button>
        </div>
        <div className="text-left">
          {FAQ.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={item.q}
                className="border-b border-[var(--border)] last:border-b-0"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="w-full bg-transparent border-none cursor-pointer px-3 py-2.5 text-left text-[12px] font-semibold text-[var(--text)] flex items-start justify-between gap-2"
                >
                  <span>{item.q}</span>
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 text-[11px] text-[var(--muted)] leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
