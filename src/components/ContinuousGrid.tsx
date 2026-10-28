import { groupItemsBySize, redLikelihoodPercent } from '../utils/sizeGroups';
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

export function ContinuousGrid(props: {
  slots: SessionSlot[];
  onThumbsUp: (id: string) => void;
  onThumbsDown: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onNewMerchant: () => void;
  listening: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Live session feed · Continuous Grid
          </h2>
          <p className="m-0 text-[11px] text-[var(--muted)]">
            {props.listening
              ? 'Listening… waiting for cargo (silence OK until Stop)'
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

      {!props.slots.length ? (
        <div className="rounded border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted)]">
          Dual-monitor continuous scan. Each pickup/drop appends a merchant slot with Group #,
          confidence, and size-grouped Red %.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {props.slots.map((slot) => {
            const mythicPossible = slot.redPct > 0;
            const groups = groupItemsBySize(slot.items);
            return (
              <article
                key={slot.id}
                className={[
                  'rounded border p-2.5',
                  mythicPossible
                    ? 'border-[var(--mythic-gold)]/70 bg-gradient-to-br from-[#2a1210] to-[#1a1608] shadow-[0_0_18px_rgba(245,197,66,0.18)]'
                    : 'border-[var(--border)] bg-[var(--bg-panel)]',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-[var(--accent)]">
                      Group #{slot.soundId}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {slot.confidence}% · {slot.kind}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={[
                        'text-xl font-bold tabular-nums',
                        mythicPossible ? 'text-[var(--mythic)]' : 'text-[var(--muted)]',
                      ].join(' ')}
                    >
                      {slot.redPct}%
                    </div>
                    <div className="text-[9px] uppercase text-[var(--mythic-gold)]">Red</div>
                  </div>
                </div>

                <ul className="m-0 mt-2 p-0 list-none space-y-1 max-h-28 overflow-auto">
                  {groups.map((g) => (
                    <li key={g.size} className="text-[10px] text-[var(--muted)]">
                      <span className="text-[var(--text)] font-medium">{g.size}</span> · Red{' '}
                      {g.redPct}% · {g.items.length} item
                      {g.items.length === 1 ? '' : 's'}
                      {g.items[0] ? ` · e.g. ${g.items[0].name}` : ''}
                    </li>
                  ))}
                </ul>

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
      )}
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
