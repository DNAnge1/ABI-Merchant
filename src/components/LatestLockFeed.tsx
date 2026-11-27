import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MerchantItem } from '../utils/audioMatcher';
import {
  filterScoredFeed,
  sizesInGroup,
  type ScoredItem,
  type TierFilter,
} from '../utils/resultProbability';
import type { RankedSoundCandidate } from '../utils/rankedGuess';
import { redLikelihoodPercent } from '../utils/sizeGroups';
import {
  CARGO_PRICE_BUCKETS,
  computeEvSummary,
  costBasisForBucket,
  scoreWithinRaidFilter,
  weightedRedChanceFromScored,
  type CargoPriceBucket,
  type MapModeOption,
  type RaidFilter,
} from '../utils/raidPools';
import {
  TacticalResultCard,
  TacticalSlotChip,
  sortHudItems,
} from './TacticalResultCard';

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

function Pill(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  accent?: 'red' | 'gold' | 'teal';
}) {
  const activeTone =
    props.accent === 'red'
      ? 'border-[var(--mythic)]/60 bg-[var(--mythic)]/15 text-[var(--mythic)]'
      : props.accent === 'gold'
        ? 'border-[var(--mythic-gold)]/55 bg-[var(--mythic-gold)]/12 text-[var(--mythic-gold)]'
        : 'border-[var(--accent)]/55 bg-[var(--accent-dim)]/25 text-[var(--accent)]';
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'rounded-full px-2.5 py-1 text-[11px] font-semibold border tabular-nums',
        props.active
          ? activeTone
          : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/40',
      ].join(' ')}
    >
      {props.label}
    </button>
  );
}

function FeedbackRow(props: {
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  /** Dismiss card + resume live narrowing for the next cargo (keeps MediaStream). */
  onSkip?: () => void;
  /** After 👍 Correct — hide vote controls, keep the card, short thank-you. */
  thanks?: boolean;
  /** Live Peek — only Next (no Correct / Report). */
  livePreview?: boolean;
}) {
  const nextBtn = props.onSkip ? (
    <button
      type="button"
      onClick={props.onSkip}
      className="rounded-lg px-3.5 py-2 text-[12px] font-semibold bg-[var(--accent)] text-[#041412] border border-transparent"
      data-next-cargo
      title="Dismiss result and listen for the next cargo — keeps screen share"
    >
      Next item
    </button>
  ) : null;

  if (props.thanks) {
    return (
      <div
        className="mt-3 pt-3 border-t border-white/8 space-y-2"
        data-correct-thanks
        role="status"
      >
        <p className="m-0 text-[12px] font-medium text-[var(--ok)]">
          Thanks — keep shopping.
        </p>
        {nextBtn}
      </div>
    );
  }
  if (props.livePreview) {
    if (!nextBtn) return null;
    return (
      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/8">
        {nextBtn}
      </div>
    );
  }
  if (!props.onThumbsUp && !props.onThumbsDown && !props.onSkip) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/8">
      {props.onThumbsDown && (
        <button
          type="button"
          onClick={props.onThumbsDown}
          className="rounded-lg px-3.5 py-2 text-[12px] font-semibold bg-[var(--mythic)]/20 border border-[var(--mythic)] text-[var(--mythic-gold)] hover:bg-[var(--mythic)]/30"
          data-report-issue
          title="Wrong guess — pick the real item and send diagnostics (no audio)"
        >
          Report issue
        </button>
      )}
      {props.onThumbsUp && (
        <button
          type="button"
          onClick={props.onThumbsUp}
          className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--ok)]/40 text-[var(--ok)]"
        >
          Correct
        </button>
      )}
      {nextBtn}
    </div>
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

function DetailsList(props: { items: ScoredItem[] }) {
  const sorted = sortHudItems(props.items.filter((i) => !i.sizeExcluded));
  return (
    <ul className="m-0 p-0 list-none space-y-1.5 text-[12px]">
      {sorted.map((item) => (
        <li
          key={item.id}
          className="flex justify-between gap-2 border-b border-white/5 pb-1"
        >
          <span className="truncate">
            {item.name}{' '}
            <span className="text-[var(--muted)]">· {item.size}</span>
          </span>
          <span className="tabular-nums shrink-0">{item.displayPct}%</span>
        </li>
      ))}
      {props.items.some((i) => i.sizeExcluded) && (
        <li className="text-[10px] text-[var(--muted)] pt-1">
          {props.items.filter((i) => i.sizeExcluded).length} excluded by size
        </li>
      )}
    </ul>
  );
}

function ViewDetailsModal(props: {
  open: boolean;
  onClose: () => void;
  items: ScoredItem[];
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Match details"
      data-view-details-modal
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 border-none cursor-pointer"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl p-4 space-y-3 max-h-[80vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-[var(--text)]">
              Full size-grouped list
            </h2>
            <p className="m-0 mt-1 text-xs text-[var(--muted)]">
              Survivors share pool-weighted match % (sum 100%). Off-size / off-raid rows stay 0% /
              excluded.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-[11px] text-[var(--muted)] border border-[var(--border)]"
          >
            Close
          </button>
        </div>
        <DetailsList items={props.items} />
      </div>
    </div>
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
  mapModes?: MapModeOption[];
  mapModeId?: string;
  cargoType?: string;
  cargoPrice?: number | '';
  cargoPriceBucket?: CargoPriceBucket;
  cargoPrices?: number[];
  onToggleSize: (size: string) => void;
  onOnlyRed: (v: boolean) => void;
  onOnlyYellow: (v: boolean) => void;
  onShowAll: () => void;
  onCargoPrice?: (price: number | '') => void;
  onCargoPriceBucket?: (bucket: CargoPriceBucket) => void;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  onSkip?: () => void;
  /** Hide vote row + show thank-you after Correct (card stays). */
  feedbackThanks?: boolean;
  lowConfidence?: boolean;
  redChancePercent?: number;
  rankedCandidates?: RankedSoundCandidate[];
  isolatedItem?: boolean;
  onPickRanked?: (soundId: number) => void;
  /** Live rolling preview while listening / moving */
  livePreview?: boolean;
  earlier?: Array<{
    id: string;
    soundId: number;
    confidence: number;
    items: MerchantItem[];
    lowConfidence?: boolean;
    redChancePercent?: number;
  }>;
  onDismissEarlier?: (id: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const tier: TierFilter = { onlyRed: props.onlyRed, onlyYellow: props.onlyYellow };
  const groupSizes = sizesInGroup(props.items);
  const bucket = props.cargoPriceBucket ?? '';
  const raidFilter: RaidFilter = useMemo(
    () => ({
      mapModeId: props.mapModeId || undefined,
      sizes: props.selectedSizes,
      cargoType: props.cargoType || undefined,
      cargoPriceBucket: bucket || undefined,
      cargoPrice: bucket ? undefined : props.cargoPrice,
    }),
    [props.mapModeId, props.selectedSizes, props.cargoType, props.cargoPrice, bucket],
  );
  const mapModes = props.mapModes ?? [];
  const scored = scoreWithinRaidFilter(props.items, raidFilter, mapModes);
  const feed = filterScoredFeed(scored, tier);
  const showEmpty = feed.length === 0;
  const sizeLabel =
    props.selectedSizes.length === 0
      ? 'all group sizes'
      : props.selectedSizes.join(' + ');
  const costBasis = bucket
    ? costBasisForBucket(bucket)
    : props.cargoPrice;
  const ev = computeEvSummary(scored, costBasis);
  const poolRed = weightedRedChanceFromScored(
    feed.length ? (feed as typeof scored) : scored,
  );

  const redChance =
    props.mapModeId || props.cargoType || bucket || props.cargoPrice
      ? poolRed
      : props.redChancePercent != null
        ? props.redChancePercent
        : poolRed || redLikelihoodPercent(feed);
  const ranked = props.rankedCandidates ?? [];
  const tierActive = props.onlyRed || props.onlyYellow;
  const useBuckets = props.onCargoPriceBucket != null;

  const sizePills: ReactNode = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] mr-1">
        Size
      </span>
      <Pill
        active={props.selectedSizes.length === 0}
        label="Any"
        onClick={() => {
          for (const s of [...props.selectedSizes]) props.onToggleSize(s);
        }}
      />
      {groupSizes.map((size) => (
        <Pill
          key={size}
          active={props.selectedSizes.includes(size)}
          label={size}
          onClick={() => props.onToggleSize(size)}
        />
      ))}
    </div>
  );

  const pricePills: ReactNode = useBuckets ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] mr-1">
        Price
      </span>
      {CARGO_PRICE_BUCKETS.map((b) => (
        <Pill
          key={b.id || 'any'}
          active={bucket === b.id}
          label={b.label}
          onClick={() => props.onCargoPriceBucket?.(bucket === b.id && b.id !== '' ? '' : b.id)}
        />
      ))}
    </div>
  ) : props.onCargoPrice ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] mr-1">
        Price
      </span>
      <Pill
        active={props.cargoPrice === ''}
        label="Any"
        onClick={() => props.onCargoPrice?.('')}
      />
      {(props.cargoPrices ?? []).map((p) => (
        <Pill
          key={p}
          active={props.cargoPrice === p}
          label={p >= 1000 ? `${Math.round(p / 1000)}k` : String(p)}
          onClick={() => props.onCargoPrice?.(props.cargoPrice === p ? '' : p)}
        />
      ))}
    </div>
  ) : null;

  const pills: ReactNode = (
    <div className="space-y-2">
      {sizePills}
      {pricePills}
      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="rounded border border-white/8 bg-black/20 px-2.5 py-1.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)]/40"
          data-advanced-settings
        >
          Advanced settings {advancedOpen ? '▴' : '▾'}
          {tierActive ? (
            <span className="ml-1.5 text-[var(--mythic-gold)]">
              ({props.onlyRed ? 'Red' : ''}
              {props.onlyRed && props.onlyYellow ? '+' : ''}
              {props.onlyYellow ? 'Yellow' : ''})
            </span>
          ) : (
            <span className="ml-1.5 text-[var(--accent)]">(Show All)</span>
          )}
        </button>
        {advancedOpen && (
          <div className="mt-2 space-y-2 rounded border border-white/8 bg-black/20 px-2.5 py-2">
            <TierFilterBar
              onlyRed={props.onlyRed}
              onlyYellow={props.onlyYellow}
              onOnlyRed={props.onOnlyRed}
              onOnlyYellow={props.onOnlyYellow}
              onShowAll={props.onShowAll}
            />
            <p className="m-0 text-[10px] text-[var(--muted)] leading-snug">
              Only Red / Only Yellow OR together. Show All clears both. Size pills redistribute
              match % over the remaining pool. Price uses ~5 buckets (not every exact price).
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5" data-tactical-feed="catch-hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[15px] font-medium" data-result-kind={props.livePreview ? 'live-peek' : 'final'}>
          {props.livePreview
            ? 'Live Peek (not final)'
            : props.lowConfidence
              ? 'Final · Best guess · Stop & Match'
              : 'Final · Stop & Match'}
        </h2>
      </div>

      {ranked.length > 1 && (
        <div className="flex flex-wrap gap-1.5 items-center" data-ranked-candidates>
          <span className="text-[10px] text-[var(--muted)]">Top sound IDs:</span>
          {ranked.map((c, idx) => (
            <button
              key={c.soundId}
              type="button"
              onClick={() => props.onPickRanked?.(c.soundId)}
              className={[
                'rounded px-2 py-1 text-[10px] border tabular-nums',
                idx === 0
                  ? 'border-[var(--accent)]/60 bg-[var(--accent-dim)]/25 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]',
              ].join(' ')}
            >
              #{c.soundId} · {c.relativeProb}%
              <span className="opacity-70"> ({c.confidence})</span>
            </button>
          ))}
        </div>
      )}

      {showEmpty ? (
        <div className="space-y-2.5">
          <div className="rounded-[10px] border border-[var(--warn)]/40 bg-[rgba(8,10,14,0.92)] p-4">
            <div className="font-semibold mb-1">No valuable items</div>
            <p className="m-0 text-[13px] text-[var(--muted)]">
              Nothing matches the current Red / Yellow / size filters. Open Advanced settings or
              choose Show All.
            </p>
            <div className="mt-3">{pills}</div>
          </div>
          <OutlineBtn onClick={() => setDetailsOpen(true)}>View Details</OutlineBtn>
        </div>
      ) : (
        <TacticalResultCard
          items={feed}
          redChancePercent={redChance}
          soundId={props.soundId}
          audioConfidence={props.audioConfidence}
          lowConfidence={props.lowConfidence}
          isolatedItem={props.isolatedItem}
          hideImages={props.hideImages}
          livePreview={props.livePreview}
          meta={`Match % within ${sizeLabel}`}
          expectedValue={ev.expectedValue}
          paybackPercent={ev.paybackPercent}
          pills={pills}
        >
          <FeedbackRow
            onThumbsUp={props.livePreview ? undefined : props.onThumbsUp}
            onThumbsDown={props.livePreview ? undefined : props.onThumbsDown}
            onSkip={props.onSkip}
            thanks={!props.livePreview && props.feedbackThanks === true}
            livePreview={props.livePreview === true}
          />
          <div className="mt-3">
            <OutlineBtn onClick={() => setDetailsOpen(true)}>View Details</OutlineBtn>
          </div>
        </TacticalResultCard>
      )}

      <ViewDetailsModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        items={scored}
      />

      {props.earlier && props.earlier.length > 0 && (
        <div>
          <p className="m-0 mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Earlier locks
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {props.earlier.map((slot) => {
              const slotScored = scoreWithinRaidFilter(slot.items, raidFilter, mapModes);
              const slotFeed = filterScoredFeed(slotScored, {
                onlyRed: false,
                onlyYellow: false,
              });
              return (
                <TacticalSlotChip
                  key={slot.id}
                  soundId={slot.soundId}
                  confidence={slot.confidence}
                  items={slotFeed.length ? slotFeed : slotScored}
                  redChancePercent={
                    slot.redChancePercent ??
                    weightedRedChanceFromScored(slotScored) ??
                    redLikelihoodPercent(slot.items)
                  }
                  lowConfidence={slot.lowConfidence}
                  hideImages={props.hideImages}
                  onDismiss={
                    props.onDismissEarlier
                      ? () => props.onDismissEarlier?.(slot.id)
                      : undefined
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
