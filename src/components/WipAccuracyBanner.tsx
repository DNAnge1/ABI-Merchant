/**
 * Standing work-in-progress notice — teal/dark, honest, not alarming.
 * Header chip lives in ChromeBar; click opens a centered modal (portaled to body).
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const GITHUB_REPO = 'https://github.com/DNAnge1/ABI-Merchant';
const GITHUB_PRS = `${GITHUB_REPO}/pulls`;
const GITHUB_ISSUES = `${GITHUB_REPO}/issues`;
const GITHUB_ACTIONS = `${GITHUB_REPO}/actions`;

/** Compact chip for ChromeBar — opens the WIP modal (portaled, never a trapped panel). */
export function WipHeaderChip(props: {
  onOpenSuggestions?: () => void;
  onOpenStats?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent-dim)]/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)] hover:border-[var(--accent)] whitespace-nowrap"
        data-wip-header
        title="Results may not be completely accurate yet — tap for details"
      >
        Work In Progress
      </button>
      <WipProgressModal
        open={open}
        onClose={() => setOpen(false)}
        onOpenSuggestions={props.onOpenSuggestions}
        onOpenStats={props.onOpenStats}
      />
    </>
  );
}

/** Full banner (Entry). Prefer {@link WipHeaderChip} in ChromeBar on other screens. */
export function WipAccuracyBanner(props: {
  prominent?: boolean;
  onOpenSuggestions?: () => void;
  onOpenStats?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const prominent = props.prominent === true;

  return (
    <>
      <button
        type="button"
        role="status"
        onClick={() => setOpen(true)}
        className={[
          'w-full rounded-lg border text-center cursor-pointer transition-colors',
          'hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
          prominent
            ? 'border-[var(--accent)]/70 bg-[var(--accent-dim)]/40 px-4 py-3'
            : 'border-[var(--accent)]/45 bg-[var(--accent-dim)]/25 px-3 py-2.5',
        ].join(' ')}
        data-wip-banner
        title="Click for how to follow progress"
      >
        <p
          className={[
            'm-0 font-semibold uppercase tracking-wider text-[var(--accent)]',
            prominent ? 'text-[12px]' : 'text-[11px]',
          ].join(' ')}
        >
          Work in progress
          <span className="ml-2 font-normal normal-case tracking-normal text-[var(--muted)]">
            · tap for details
          </span>
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
      </button>

      <WipProgressModal
        open={open}
        onClose={() => setOpen(false)}
        onOpenSuggestions={props.onOpenSuggestions}
        onOpenStats={props.onOpenStats}
      />
    </>
  );
}

export function WipProgressModal(props: {
  open: boolean;
  onClose: () => void;
  onOpenSuggestions?: () => void;
  onOpenStats?: () => void;
}) {
  const { open, onClose } = props;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!props.open || typeof document === 'undefined') return null;

  // Portal to body so a transform ancestor (e.g. absolute-centered chip) cannot trap
  // position:fixed into a tall vertical panel.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Work in progress details"
      data-wip-modal
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 border-none cursor-pointer"
        aria-label="Close"
        onClick={props.onClose}
      />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2.5">
          <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            Work in progress
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded px-2 py-1 text-[11px] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--text)]"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="m-0 text-[12px] text-[var(--muted)] leading-relaxed">
            Results may not be completely accurate yet — we’re still tuning matching from field
            captures. Track GitHub progress, leave Suggestions, or open community Stats.
          </p>

          <ul className="m-0 p-0 list-none space-y-2">
            <li>
              <a
                href={GITHUB_PRS}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] hover:border-[var(--accent)]/50 no-underline"
              >
                <span className="font-semibold text-[var(--accent)]">Open pull requests</span>
                <span className="block text-[11px] text-[var(--muted)] mt-0.5">
                  See what landed and what’s in review on GitHub
                </span>
              </a>
            </li>
            <li>
              <a
                href={GITHUB_ACTIONS}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] hover:border-[var(--accent)]/50 no-underline"
              >
                <span className="font-semibold text-[var(--accent)]">GitHub Actions / Pages</span>
                <span className="block text-[11px] text-[var(--muted)] mt-0.5">
                  Live site updates after merge when Pages is green
                </span>
              </a>
            </li>
            <li>
              <a
                href={GITHUB_ISSUES}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] hover:border-[var(--accent)]/50 no-underline"
              >
                <span className="font-semibold text-[var(--accent)]">Issues</span>
                <span className="block text-[11px] text-[var(--muted)] mt-0.5">
                  Report a miss or request a fix
                </span>
              </a>
            </li>
          </ul>

          <div className="flex flex-wrap gap-2 pt-1">
            {props.onOpenSuggestions && (
              <button
                type="button"
                onClick={() => {
                  props.onClose();
                  props.onOpenSuggestions?.();
                }}
                className="rounded-lg px-3 py-2 text-[12px] font-semibold bg-[var(--accent)] text-[#041412]"
              >
                💡 Suggestions
              </button>
            )}
            {props.onOpenStats && (
              <button
                type="button"
                onClick={() => {
                  props.onClose();
                  props.onOpenStats?.();
                }}
                className="rounded-lg px-3 py-2 text-[12px] font-semibold border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
              >
                Community Stats
              </button>
            )}
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-3 py-2 text-[12px] font-medium border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] no-underline"
            >
              Repo
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
