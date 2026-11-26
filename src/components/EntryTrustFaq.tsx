/**
 * Entry-only trust FAQ accordion. Keep off Catch / Listen HUD.
 * Q&A is original for this fan companion — not copied from ABI Builder.
 */

import type { ReactNode } from 'react';

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
        cannot promise how publisher policies treat external helpers. Use at your own discretion;
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
        fingerprint comparison and is not uploaded as recordings. Optional community 👍/👎 and
        Suggestions send only coarse tallies / short text to a Cloudflare Worker when online —
        never your audio stream.
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

export function EntryTrustFaq() {
  return (
    <div className="w-full max-w-md mx-auto text-left" data-entry-trust-faq>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]/80 overflow-hidden">
        <p className="m-0 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] border-b border-[var(--border)]">
          Trust &amp; safety FAQ
        </p>
        {FAQ.map((item, i) => (
          <details
            key={item.q}
            className="border-b border-[var(--border)] last:border-b-0 group"
            open={i === 0}
          >
            <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-semibold text-[var(--text)] flex items-start justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span>{item.q}</span>
              <span className="shrink-0 text-[10px] text-[var(--muted)] group-open:hidden">▸</span>
              <span className="shrink-0 text-[10px] text-[var(--muted)] hidden group-open:inline">
                ▾
              </span>
            </summary>
            <div className="px-3 pb-3 text-[11px] text-[var(--muted)] leading-relaxed">{item.a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
