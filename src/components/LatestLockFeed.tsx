import { useState } from 'react';
import type { MerchantItem } from '../utils/audioMatcher';
import {
  filterScoredFeed,
  itemTier,
  scoreWithinSizes,
  sizesInGroup,
  type ScoredItem,
  type TierFilter,
} from '../utils/resultProbability';

function formatPrice(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function ItemThumb(props: { item: MerchantItem; hide?: boolean; size?: 'sm' | 'lg' }) {
  if (props.hide) return null;
  const dim = props.size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';
  if (props.item.iconUrl) {
    return (
      <img
        src={props.item.iconUrl}
        alt=""
        className={`${dim} object-contain rounded bg-black/30 shrink-0`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return <div className={`${dim} rounded bg-black/30 shrink-0`} />;
}

export function TierFilterBar(props: {
  onlyRed: boolean;
  onlyYellow: boolean;
  onOnlyRed: (v: boolean) => void;
  onOnlyYellow: (v: boolean) => void;
  onShowAll: () => void;
}) {
  const showAll = !props.onlyRed && !props.onlyYellow;
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <CheckOpt
        checked={props.onlyRed}
        label="Only Red"
        onChange={() => props.onOnlyRed(!props.onlyRed)}
      />
      <CheckOpt
        checked={props.onlyYellow}
        label="Only Yellow"
        onChange={() => props.onOnlyYellow(!props.onlyYellow)}
      />
      <CheckOpt
        checked={showAll}
        label="Show All"
        onChange={() => {
          if (!showAll) props.onShowAll();
        }}
      />
    </div>
  );
}

function CheckOpt(props: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-[13px] text-[var(--text)]">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onChange}
        className="accent-[var(--accent)] w-3.5 h-3.5"
      />
      {props.label}
    </label>
  );
}

export function LatestLockFeed(props: {
  soundId: number;
  audioConfidence: number;
  items: MerchantItem[];
  hideImages: boolean;
  onlyRed: boolean;
  onlyYellow: boolean;
  selectedSizes: string[];
  onToggleSize: (size: string) => void;
  onOnlyRed: (v: boolean) => void;
  onOnlyYellow: (v: boolean) => void;
  onShowAll: () => void;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  onSkip?: () => void;
  /** Earlier Multi locks (compact) */
  earlier?: Array<{
    id: string;
    soundId: number;
    confidence: number;
    items: MerchantItem[];
  }>;
  onDismissEarlier?: (id: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const tier: TierFilter = { onlyRed: props.onlyRed, onlyYellow: props.onlyYellow };
  const groupSizes = sizesInGroup(props.items);
  const scored = scoreWithinSizes(props.items, props.selectedSizes);
  const feed = filterScoredFeed(scored, tier);
  const showEmpty = feed.length === 0;
  const headline = [...feed].sort((a, b) => b.displayPct - a.displayPct)[0];
  const sizeLabel =
    props.selectedSizes.length === 0
      ? 'all group sizes'
      : props.selectedSizes.join(' + ');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[17px] font-medium">Latest lock</h2>
      </div>

      <TierFilterBar
        onlyRed={props.onlyRed}
        onlyYellow={props.onlyYellow}
        onOnlyRed={props.onOnlyRed}
        onOnlyYellow={props.onOnlyYellow}
        onShowAll={props.onShowAll}
      />

      <div className="space-y-1.5">
        <p className="m-0 text-xs text-[var(--muted)] leading-snug">
          Cargo sizes in this sound group only. After you check sizes, probabilities are
          redistributed over remaining items.
        </p>
        <div className="flex flex-wrap gap-3.5">
          {groupSizes.map((size) => (
            <CheckOpt
              key={size}
              checked={
                props.selectedSizes.length === 0
                  ? false
                  : props.selectedSizes.includes(size)
              }
              label={size}
              onChange={() => props.onToggleSize(size)}
            />
          ))}
          {props.selectedSizes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                // clear all sizes → any size in group
                for (const s of [...props.selectedSizes]) props.onToggleSize(s);
              }}
              className="text-[11px] text-[var(--muted)] underline"
            >
              Clear sizes (any)
            </button>
          )}
        </div>
      </div>

      {showEmpty ? (
        <div className="space-y-2.5">
          <div className="rounded-[10px] border border-[var(--warn)]/40 bg-[var(--bg-elevated)] p-4">
            <div className="font-semibold mb-1">No valuable items</div>
            <p className="m-0 text-[13px] text-[var(--muted)]">
              Nothing matches the current Red / Yellow / size filters. Open View Details or choose
              Show All.
            </p>
          </div>
          <OutlineBtn onClick={() => setDetailsOpen(!detailsOpen)}>
            {detailsOpen ? 'Hide Details' : 'View Details'}
          </OutlineBtn>
          {detailsOpen && (
            <ItemList items={scored} hideImages={props.hideImages} audioConfidence={props.audioConfidence} />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 space-y-3">
          <div className="flex gap-3 items-center">
            {headline && <ItemThumb item={headline} hide={props.hideImages} size="lg" />}
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold">
                {headline?.name}
                {headline && (
                  <span
                    className={
                      itemTier(headline) === 'Red'
                        ? ' text-[var(--mythic)]'
                        : itemTier(headline) === 'Yellow'
                          ? ' text-[var(--mythic-gold)]'
                          : ' text-[var(--muted)]'
                    }
                  >
                    {' '}
                    · {headline.displayPct}%
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--muted)]">
                Match probability (within selected sizes: {sizeLabel}) · {headline?.size} · Group #
                {props.soundId}
                {headline && headline.contactPrice > 0
                  ? ` · ${headline.contactPrice.toLocaleString()} Koen`
                  : ''}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">
                Audio confidence (separate): {props.audioConfidence}%
              </div>
            </div>
          </div>

          <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Match probability (within selected sizes)
          </p>
          <ItemList items={feed} hideImages={props.hideImages} audioConfidence={props.audioConfidence} />

          {(props.onThumbsUp || props.onThumbsDown || props.onSkip) && (
            <div className="flex flex-wrap gap-2">
              {props.onThumbsUp && (
                <button
                  type="button"
                  onClick={props.onThumbsUp}
                  className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--ok)]/40 text-[var(--ok)]"
                >
                  👍 Correct
                </button>
              )}
              {props.onThumbsDown && (
                <button
                  type="button"
                  onClick={props.onThumbsDown}
                  className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--mythic)]/40 text-[var(--mythic-gold)]"
                >
                  👎 Wrong
                </button>
              )}
              {props.onSkip && (
                <button
                  type="button"
                  onClick={props.onSkip}
                  className="rounded px-3 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)]"
                >
                  Skip
                </button>
              )}
            </div>
          )}

          <OutlineBtn onClick={() => setDetailsOpen(!detailsOpen)}>
            {detailsOpen ? 'Hide Details' : 'View Details'}
          </OutlineBtn>
          {detailsOpen && (
            <div className="space-y-1.5">
              <div className="text-[13px] font-semibold">Full size-grouped list</div>
              <p className="m-0 text-xs text-[var(--muted)]">
                Survivors share equal match % (sum 100%). Off-size rows stay 0% / excluded.
              </p>
              <ItemList
                items={scored}
                hideImages={props.hideImages}
                audioConfidence={props.audioConfidence}
              />
            </div>
          )}
        </div>
      )}

      {props.earlier && props.earlier.length > 0 && (
        <div>
          <p className="m-0 mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Earlier locks
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {props.earlier.map((slot) => {
              const top = slot.items[0];
              return (
                <article
                  key={slot.id}
                  className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-2.5 flex gap-2 items-center"
                >
                  {top && <ItemThumb item={top} hide={props.hideImages} />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold truncate">
                      {top?.name ?? `Group #${slot.soundId}`}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      Group #{slot.soundId} · {slot.confidence}% audio
                    </div>
                  </div>
                  {props.onDismissEarlier && (
                    <button
                      type="button"
                      onClick={() => props.onDismissEarlier?.(slot.id)}
                      className="text-[11px] text-[var(--muted)]"
                    >
                      ✕
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemList(props: {
  items: ScoredItem[];
  hideImages: boolean;
  audioConfidence: number;
}) {
  return (
    <ul className="m-0 p-0 list-none space-y-2">
      {props.items.map((item) => {
        const excluded = item.sizeExcluded || item.displayPct === 0;
        const tier = itemTier(item);
        return (
          <li
            key={item.id}
            className={[
              'flex gap-2.5 items-center rounded-lg border px-2.5 py-2',
              excluded
                ? 'border-[var(--border)] opacity-55'
                : tier === 'Red'
                  ? 'border-[var(--mythic)]/40 bg-[var(--bg-elevated)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)]',
            ].join(' ')}
          >
            <ItemThumb item={item} hide={props.hideImages} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate">{item.name}</div>
              <div className="text-[11px] text-[var(--muted)]">
                <span
                  className={
                    tier === 'Red'
                      ? 'text-[var(--mythic)]'
                      : tier === 'Yellow'
                        ? 'text-[var(--mythic-gold)]'
                        : ''
                  }
                >
                  {tier}
                </span>
                {' · '}
                {item.size}
                {' · '}
                {excluded ? (
                  <span className="text-[var(--warn)]">0% · excluded (size)</span>
                ) : (
                  <span>{item.displayPct}% match probability (within selected sizes)</span>
                )}
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5">
                Audio confidence: {props.audioConfidence}%
                {item.contactPrice > 0 ? ` · ${formatPrice(item.contactPrice)} Koen` : ''}
              </div>
            </div>
            <div
              className={[
                'text-xs font-semibold tabular-nums',
                excluded ? 'text-[var(--muted)]' : 'text-[var(--accent)]',
              ].join(' ')}
            >
              {item.contactPrice > 0 ? formatPrice(item.contactPrice) : '—'}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OutlineBtn(props: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-lg px-3.5 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
    >
      {props.children}
    </button>
  );
}
