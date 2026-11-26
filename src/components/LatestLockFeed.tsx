import { useMemo, useState, type ReactNode } from 'react';
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
  computeEvSummary,
  formatKoen,
  scoreWithinRaidFilter,
  weightedRedChanceFromScored,
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
  onSkip?: () => void;
}) {
  if (!props.onThumbsUp && !props.onThumbsDown && !props.onSkip) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/8">
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
  cargoPrices?: number[];
  onToggleSize: (size: string) => void;
  onOnlyRed: (v: boolean) => void;
  onOnlyYellow: (v: boolean) => void;
  onShowAll: () => void;
  onCargoPrice?: (price: number | '') => void;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  onSkip?: () => void;
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
  const tier: TierFilter = { onlyRed: props.onlyRed, onlyYellow: props.onlyYellow };
  const groupSizes = sizesInGroup(props.items);
  const raidFilter: RaidFilter = useMemo(
    () => ({
      mapModeId: props.mapModeId || undefined,
      sizes: props.selectedSizes,
      cargoType: props.cargoType || undefined,
      cargoPrice: props.cargoPrice,
    }),
    [props.mapModeId, props.selectedSizes, props.cargoType, props.cargoPrice],
  );
  const mapModes = props.mapModes ?? [];
  const scored = scoreWithinRaidFilter(props.items, raidFilter, mapModes);
  const feed = filterScoredFeed(scored, tier);
  const showEmpty = feed.length === 0;
  const sizeLabel =
    props.selectedSizes.length === 0
      ? 'all group sizes'
      : props.selectedSizes.join(' + ');
  const ev = computeEvSummary(scored, props.cargoPrice);
  const poolRed = weightedRedChanceFromScored(
    feed.length ? (feed as typeof scored) : scored,
  );

  const redChance =
    props.mapModeId || props.cargoType || props.cargoPrice
      ? poolRed
      : props.redChancePercent != null
        ? props.redChancePercent
        : poolRed || redLikelihoodPercent(feed);
  const ranked = props.rankedCandidates ?? [];
  const cargoPrices = props.cargoPrices ?? [];
  const tierActive = props.onlyRed || props.onlyYellow;

  const pills: ReactNode = (
    <div className="space-y-2">
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
      {cargoPrices.length > 0 && props.onCargoPrice && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] mr-1">
            Price
          </span>
          <Pill
            active={props.cargoPrice === ''}
            label="Any"
            onClick={() => props.onCargoPrice?.('')}
          />
          {cargoPrices.map((p) => (
            <Pill
              key={p}
              active={props.cargoPrice === p}
              label={formatKoen(p)}
              onClick={() =>
                props.onCargoPrice?.(props.cargoPrice === p ? '' : p)
              }
            />
          ))}
        </div>
      )}
      <details className="rounded border border-white/8 bg-black/20 px-2.5 py-1.5 group">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] text-[var(--muted)] [&::-webkit-details-marker]:hidden">
          <span>
            Advanced · filters
            {tierActive ? (
              <span className="ml-1.5 text-[var(--mythic-gold)]">
                ({props.onlyRed ? 'Red' : ''}
                {props.onlyRed && props.onlyYellow ? '+' : ''}
                {props.onlyYellow ? 'Yellow' : ''})
              </span>
            ) : (
              <span className="ml-1.5 text-[var(--accent)]">(Show All)</span>
            )}
          </span>
          <span className="group-open:hidden">▸</span>
          <span className="hidden group-open:inline">▾</span>
        </summary>
        <div className="mt-2 space-y-2 border-t border-white/8 pt-2">
          <TierFilterBar
            onlyRed={props.onlyRed}
            onlyYellow={props.onlyYellow}
            onOnlyRed={props.onOnlyRed}
            onOnlyYellow={props.onOnlyYellow}
            onShowAll={props.onShowAll}
          />
          <p className="m-0 text-[10px] text-[var(--muted)] leading-snug">
            Only Red / Only Yellow OR together. Show All clears both. Size pills
            redistribute match % over the remaining pool.
          </p>
        </div>
      </details>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5" data-tactical-feed="catch-hud">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[15px] font-medium">
          {props.livePreview
            ? 'Live narrowing'
            : props.lowConfidence
              ? 'Best guess'
              : 'Latest lock'}
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
              Nothing matches the current Red / Yellow / size filters. Open Advanced
              or choose Show All.
            </p>
            <div className="mt-3">{pills}</div>
          </div>
          <OutlineBtn onClick={() => setDetailsOpen(!detailsOpen)}>
            {detailsOpen ? 'Hide Details' : 'View Details'}
          </OutlineBtn>
          {detailsOpen && <DetailsList items={scored} />}
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
          {!props.livePreview && (
            <FeedbackRow
              onThumbsUp={props.onThumbsUp}
              onThumbsDown={props.onThumbsDown}
              onSkip={props.onSkip}
            />
          )}
          <div className="mt-3">
            <OutlineBtn onClick={() => setDetailsOpen(!detailsOpen)}>
              {detailsOpen ? 'Hide Details' : 'View Details'}
            </OutlineBtn>
            {detailsOpen && (
              <div className="mt-2 space-y-1.5">
                <div className="text-[13px] font-semibold">Full size-grouped list</div>
                <p className="m-0 text-xs text-[var(--muted)]">
                  Survivors share pool-weighted match % (sum 100%). Off-size / off-raid
                  rows stay 0% / excluded.
                </p>
                <DetailsList items={scored} />
              </div>
            )}
          </div>
        </TacticalResultCard>
      )}

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
