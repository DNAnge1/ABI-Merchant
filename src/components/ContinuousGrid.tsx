import {
  groupItemsBySize,
  redLikelihoodPercent,
  sortRedsFirst,
} from '../utils/sizeGroups';
import type { MerchantItem } from '../utils/audioMatcher';

export interface SessionSlot {
  id: string;
  soundId: number;
  confidence: number;
  kind: string;
  redPct: number;
  items: MerchantItem[];
  ts: number;
}

function formatPrice(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function rarityLabel(r: number): string {
  if (r >= 6) return 'Red';
  if (r >= 5) return 'Yellow';
  if (r >= 4) return 'Purple';
  if (r >= 3) return 'Blue';
  return 'Common';
}

/** Human-readable headline for a locked group (names + value, not just Group #). */
function SlotValueSummary(props: { slot: SessionSlot; featured?: boolean }) {
  const sorted = sortRedsFirst(props.slot.items);
  const headline = sorted[0];
  const reds = sorted.filter((i) => i.rarity >= 6);
  const nameLine = sorted
    .slice(0, props.featured ? 6 : 3)
    .map((i) => i.name)
    .join(' · ');
  const more = sorted.length > (props.featured ? 6 : 3) ? ` +${sorted.length - (props.featured ? 6 : 3)} more` : '';

  return (
    <div className={props.featured ? 'space-y-1.5' : 'space-y-0.5'}>
      <div
        className={[
          'font-bold text-[var(--accent)]',
          props.featured ? 'text-2xl' : 'text-sm',
        ].join(' ')}
      >
        {headline ? headline.name : `Group #${props.slot.soundId}`}
      </div>
      {headline && (
        <div
          className={[
            'text-[var(--muted)]',
            props.featured ? 'text-sm' : 'text-[10px]',
          ].join(' ')}
        >
          Group #{props.slot.soundId} · {props.slot.confidence}% · {headline.size}
          {headline.contactPrice > 0 ? ` · ~${formatPrice(headline.contactPrice)}` : ''}
          {reds.length > 0
            ? ` · ${reds.length} Red`
            : ` · ${rarityLabel(headline.rarity)}`}
        </div>
      )}
      {props.featured && nameLine && (
        <p className="m-0 text-xs leading-relaxed text-[var(--text)]">
          {nameLine}
          {more}
        </p>
      )}
      {!props.featured && sorted.length > 1 && (
        <p className="m-0 text-[10px] text-[var(--muted)] truncate">
          {nameLine}
          {more}
        </p>
      )}
    </div>
  );
}

export function ContinuousGrid(props: {
  slots: SessionSlot[];
  onThumbsUp: (id: string) => void;
  onThumbsDown: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onNewMerchant: () => void;
  listening: boolean;
}) {
  const latest = props.slots[0] ?? null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Live session feed · Continuous Grid
          </h2>
          <p className="m-0 text-[11px] text-[var(--muted)]">
            {props.listening
              ? 'Multi / listening — move each cargo 3×; locks append here'
              : 'Not listening'}{' '}
            · {props.slots.length} slot{props.slots.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={props.onClearAll}
            className="rounded px-2 py-1 text-[11px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            Clear All
          </button>
          <button
            type="button"
            onClick={props.onNewMerchant}
            className="rounded px-2 py-1 text-[11px] border border-[var(--accent)]/50 text-[var(--accent)]"
          >
            New Merchant Refresh
          </button>
        </div>
      </div>

      {latest && (
        <div
          className={[
            'rounded border px-4 py-3',
            latest.redPct > 0
              ? 'border-[var(--mythic-gold)]/70 bg-gradient-to-br from-[#2a1210] to-[#1a1608]'
              : 'border-[var(--accent)] bg-[var(--bg-elevated)]',
          ].join(' ')}
        >
          <p className="m-0 text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">
            Latest lock · what you matched
          </p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <SlotValueSummary slot={latest} featured />
            <div className="text-right shrink-0">
              <div
                className={[
                  'text-3xl font-bold tabular-nums',
                  latest.redPct > 0 ? 'text-[var(--mythic)]' : 'text-[var(--muted)]',
                ].join(' ')}
              >
                {latest.redPct}%
              </div>
              <div className="text-[10px] uppercase text-[var(--mythic-gold)]">Red chance</div>
            </div>
          </div>
          {/* Size breakdown for the latest only — keeps older cards lighter */}
          <ul className="m-0 mt-3 p-0 list-none flex flex-wrap gap-2">
            {groupItemsBySize(latest.items).map((g) => {
              const top = sortRedsFirst(g.items)[0];
              return (
                <li
                  key={g.size}
                  className="rounded border border-[var(--border)] bg-[var(--bg)]/60 px-2 py-1 text-[10px] text-[var(--muted)]"
                >
                  <span className="text-[var(--text)] font-medium">{g.size}</span>
                  {top ? ` · ${top.name}` : ''}
                  {g.redPct > 0 ? ` · Red ${g.redPct}%` : ''}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => props.onThumbsUp(latest.id)}
              className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--ok)]/40 text-[var(--ok)]"
            >
              👍 Correct
            </button>
            <button
              type="button"
              onClick={() => props.onThumbsDown(latest.id)}
              className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--mythic)]/40 text-[var(--mythic-gold)]"
            >
              👎 Wrong
            </button>
            <button
              type="button"
              onClick={() => props.onDismiss(latest.id)}
              className="rounded px-3 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)]"
            >
              Dismiss
            </button>
          </div>
          <p className="m-0 mt-2 text-[10px] text-[var(--muted)]">
            High-ticket-only filter (Yellow/Red) comes in the simple GUI rebuild — feed still shows
            full group for now.
          </p>
        </div>
      )}

      {!props.slots.length ? (
        <div className="rounded border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted)]">
          Dual + Multiple Items: Arm Multi scan, drag each cargo <strong>3 times</strong>. Each lock
          shows item names and value here (not just Group #).
        </div>
      ) : props.slots.length > 1 ? (
        <div>
          <p className="m-0 mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Earlier locks
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {props.slots.slice(1).map((slot) => {
              const mythicPossible = slot.redPct > 0;
              return (
                <article
                  key={slot.id}
                  className={[
                    'rounded border p-2.5',
                    mythicPossible
                      ? 'border-[var(--mythic-gold)]/50 bg-[var(--bg-panel)]'
                      : 'border-[var(--border)] bg-[var(--bg-panel)]',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <SlotValueSummary slot={slot} />
                    <div className="text-right shrink-0">
                      <div
                        className={[
                          'text-lg font-bold tabular-nums',
                          mythicPossible ? 'text-[var(--mythic)]' : 'text-[var(--muted)]',
                        ].join(' ')}
                      >
                        {slot.redPct}%
                      </div>
                      <div className="text-[9px] uppercase text-[var(--mythic-gold)]">Red</div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => props.onThumbsUp(slot.id)}
                      className="flex-1 rounded py-1 text-[11px] border border-[var(--ok)]/40 text-[var(--ok)]"
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onThumbsDown(slot.id)}
                      className="flex-1 rounded py-1 text-[11px] border border-[var(--mythic)]/40 text-[var(--mythic-gold)]"
                    >
                      👎
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onDismiss(slot.id)}
                      className="rounded px-2 py-1 text-[11px] border border-[var(--border)] text-[var(--muted)]"
                    >
                      ✕
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function buildSlotFromMatch(
  match: { soundId: number; confidence: number; kind: string },
  allItems: MerchantItem[],
): SessionSlot {
  const slotItems = allItems.filter((i) => i.soundId === match.soundId);
  return {
    id: `${Date.now()}-${match.soundId}-${Math.random().toString(36).slice(2, 6)}`,
    soundId: match.soundId,
    confidence: match.confidence,
    kind: match.kind,
    redPct: redLikelihoodPercent(slotItems),
    items: slotItems,
    ts: Date.now(),
  };
}
