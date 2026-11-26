import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  fetchSuggestions,
  hasLocalUpvote,
  markLocalUpvote,
  MAX_LEN,
  MIN_DWELL_MS,
  MIN_LEN,
  postSuggestion,
  readCachedSuggestions,
  type Suggestion,
  type SuggestionSort,
  upvoteSuggestion,
  validateSuggestionBody,
} from '../utils/suggestionsApi';

export function SuggestionsModal(props: { open: boolean; onClose: () => void }) {
  const [sort, setSort] = useState<SuggestionSort>('top');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const openedAt = useRef(Date.now());
  const votedTick = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!props.open) return;
    openedAt.current = Date.now();
    setFormOpen(false);
    setFormError(null);
    setSubmitNote(null);
    setDraft('');
    setHoneypot('');
    const cached = readCachedSuggestions(sort);
    if (cached) setItems(cached);
    let cancelled = false;
    setLoading(true);
    void fetchSuggestions(sort).then((list) => {
      if (cancelled) return;
      setLoading(false);
      if (!list) {
        setOffline(true);
        return;
      }
      setOffline(false);
      setItems(list.suggestions);
    });
    return () => {
      cancelled = true;
    };
  }, [props.open, sort]);

  if (!props.open) return null;

  const errMsg = draft ? validateSuggestionBody(draft) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validateSuggestionBody(draft);
    if (v) {
      setFormError(v);
      return;
    }
    const dwellMs = Date.now() - openedAt.current;
    if (dwellMs < MIN_DWELL_MS) {
      setFormError('Take a second to write a clear suggestion, then try again.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const created = await postSuggestion({
      body: draft,
      dwellMs,
      honeypot,
    });
    setSubmitting(false);
    if (!created) {
      // Optimistic local ghost so the board still feels live offline
      const local: Suggestion = {
        id: `local-${Date.now()}`,
        body: draft.trim(),
        createdAt: Date.now(),
        upvoteCount: 0,
      };
      setItems((prev) => [local, ...prev]);
      setDraft('');
      setFormOpen(false);
      setSubmitNote('Saved locally — will sync when the Worker is reachable. (Or rate-limited.)');
      setOffline(true);
      return;
    }
    setItems((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
    setDraft('');
    setFormOpen(false);
    setSubmitNote('Posted — thanks!');
    setOffline(false);
  }

  async function onUpvote(id: string) {
    if (id.startsWith('local-') || hasLocalUpvote(id)) return;
    markLocalUpvote(id);
    votedTick.current += 1;
    force((n) => n + 1);
    setItems((prev) =>
      prev.map((s) => (s.id === id ? { ...s, upvoteCount: s.upvoteCount + 1 } : s)),
    );
    const updated = await upvoteSuggestion(id);
    if (updated) {
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
      setOffline(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-4 pt-14 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suggestions-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <section className="w-full max-w-lg rounded border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 id="suggestions-title" className="m-0 text-sm font-semibold text-[var(--text)]">
              💡 Suggestions
            </h2>
            <p className="m-0 mt-0.5 text-[11px] text-[var(--muted)]">
              Live board — upvote ideas. No links. Fail-soft if offline.
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded px-2.5 py-1 text-[11px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            Close
          </button>
        </header>

        <div className="px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded border border-[var(--border)] overflow-hidden text-[11px]">
              <SortTab active={sort === 'top'} onClick={() => setSort('top')} label="Top" />
              <SortTab
                active={sort === 'newest'}
                onClick={() => setSort('newest')}
                label="Newest"
                border
              />
            </div>
            {loading && <span className="text-[10px] text-[var(--muted)]">Loading…</span>}
            {offline && (
              <span className="text-[10px] text-[var(--warn)]">Worker offline — showing cache</span>
            )}
          </div>

          <details
            className="rounded border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2"
            open={formOpen}
            onToggle={(e) => setFormOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-[12px] font-semibold text-[var(--accent)]">
              Add a suggestion ▾
            </summary>
            <form className="mt-2 space-y-2" onSubmit={(e) => void onSubmit(e)}>
              {/* Honeypot — hidden from humans */}
              <label className="absolute left-[-9999px] h-0 w-0 overflow-hidden" aria-hidden>
                Website
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />
              </label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={MAX_LEN}
                placeholder="What would make Catch / matching better? (no URLs)"
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[12px] text-[var(--text)] resize-y min-h-[4.5rem]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-[var(--muted)] tabular-nums">
                  {draft.trim().length}/{MAX_LEN} · min {MIN_LEN}
                </span>
                <button
                  type="submit"
                  disabled={submitting || !!errMsg || draft.trim().length < MIN_LEN}
                  className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412] disabled:opacity-50"
                >
                  {submitting ? 'Posting…' : 'Post'}
                </button>
              </div>
              {(formError || errMsg) && (
                <p className="m-0 text-[11px] text-[var(--mythic-gold)]">{formError || errMsg}</p>
              )}
            </form>
          </details>

          {submitNote && (
            <p className="m-0 text-[11px] text-[var(--ok)]">{submitNote}</p>
          )}

          <ul className="m-0 p-0 list-none space-y-2 max-h-[50vh] overflow-y-auto">
            {items.length === 0 && !loading && (
              <li className="rounded border border-dashed border-[var(--border)] px-3 py-6 text-center text-[12px] text-[var(--muted)]">
                No suggestions yet — be the first.
              </li>
            )}
            {items.map((s) => {
              const voted = hasLocalUpvote(s.id) || s.id.startsWith('local-');
              return (
                <li
                  key={s.id}
                  className="rounded border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2.5 flex gap-3"
                >
                  <button
                    type="button"
                    disabled={voted}
                    onClick={() => void onUpvote(s.id)}
                    title={voted ? 'Already upvoted' : 'Upvote'}
                    className={[
                      'shrink-0 flex flex-col items-center justify-center min-w-[2.5rem] rounded border px-1.5 py-1 text-[11px]',
                      voted
                        ? 'border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent-dim)]/20 cursor-default'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
                    ].join(' ')}
                  >
                    <span aria-hidden>▲</span>
                    <span className="tabular-nums font-semibold">{s.upvoteCount}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[12px] text-[var(--text)] leading-relaxed whitespace-pre-wrap break-words">
                      {s.body}
                    </p>
                    <p className="m-0 mt-1 text-[10px] text-[var(--muted)]">
                      {formatWhen(s.createdAt)}
                      {s.id.startsWith('local-') ? ' · local only' : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}

function SortTab(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  border?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'px-3 py-1.5 font-medium',
        props.border ? 'border-l border-[var(--border)]' : '',
        props.active
          ? 'bg-[var(--accent-dim)] text-[var(--text)]'
          : 'text-[var(--muted)] hover:text-[var(--text)]',
      ].join(' ')}
    >
      {props.label}
    </button>
  );
}

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
