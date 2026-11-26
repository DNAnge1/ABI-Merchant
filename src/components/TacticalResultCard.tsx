/**
 * Phase 3 — dark tactical probability HUD for the active scan result card.
 * EZ Red–style: Red Chance header, rarity-border thumbnail grid, % + size badges.
 */

import type { ReactNode } from 'react';
import {
  itemImage,
  itemInitials,
  rarityHue,
  rarityHueBorderClass,
  rarityHueTextClass,
  type RarityHue,
} from '../utils/itemDisplay';
import type { ScoredItem } from '../utils/resultProbability';

function formatPrice(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function formatPct(n: number): string {
  if (Number.isInteger(n)) return `${n}%`;
  return `${Math.round(n * 10) / 10}%`;
}

/** Sort: match probability desc, then rarity desc, then value, then name. */
export function sortHudItems(items: ScoredItem[]): ScoredItem[] {
  return [...items].sort(
    (a, b) =>
      b.displayPct - a.displayPct ||
      b.rarity - a.rarity ||
      b.contactPrice - a.contactPrice ||
      a.name.localeCompare(b.name),
  );
}

function HudTile(props: {
  item: ScoredItem;
  hideImages?: boolean;
  lockedHighlight?: boolean;
  compact?: boolean;
}) {
  const hue = rarityHue(props.item);
  const src = props.hideImages ? null : itemImage(props.item);
  const border = rarityHueBorderClass(hue);
  const pct = props.item.displayPct;
  const box = props.compact ? 'w-[4.5rem] h-[4.5rem]' : 'w-[5.75rem] h-[5.75rem] sm:w-[6.5rem] sm:h-[6.5rem]';

  return (
    <article
      className={[
        'relative overflow-hidden rounded-md border bg-[#0a0c10]/90',
        box,
        border,
        props.lockedHighlight
          ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[#0a0c10]'
          : '',
        hue === 'red' ? 'bg-[#1a0c10]/80' : '',
      ].join(' ')}
      title={`${props.item.name} · ${formatPct(pct)}`}
      data-hud-tile
      data-rarity={hue}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-contain p-1.5"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className={[
            'absolute inset-0 flex flex-col items-center justify-center gap-0.5 font-semibold uppercase',
            rarityHueTextClass(hue),
          ].join(' ')}
        >
          <span className="text-sm tracking-wide">{itemInitials(props.item.name)}</span>
        </div>
      )}

      {/* Size badge — top-left */}
      <span className="absolute top-0.5 left-0.5 rounded px-1 py-[1px] text-[8px] font-bold tabular-nums bg-black/75 text-[var(--text)] border border-white/10 leading-none">
        {props.item.size}
      </span>

      {/* Probability — top-right */}
      <span
        className={[
          'absolute top-0.5 right-0.5 rounded px-1 py-[1px] text-[9px] font-bold tabular-nums bg-black/80 leading-none',
          hue === 'red'
            ? 'text-[var(--mythic)]'
            : hue === 'yellow'
              ? 'text-[var(--mythic-gold)]'
              : 'text-white',
        ].join(' ')}
      >
        {formatPct(pct)}
      </span>

      {/* Name overlay — bottom */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1 pb-1 pt-4">
        <div className="text-[9px] font-semibold leading-tight text-white line-clamp-2 drop-shadow">
          {props.item.name}
        </div>
      </div>
    </article>
  );
}

function SideRow(props: { item: ScoredItem; lockedHighlight?: boolean }) {
  const hue = rarityHue(props.item);
  const bar =
    hue === 'red'
      ? 'bg-[var(--mythic)]'
      : hue === 'yellow'
        ? 'bg-[var(--mythic-gold)]'
        : 'bg-[#6b8cff]';

  return (
    <li
      className={[
        'flex gap-2 items-center min-w-0 py-1.5 border-b border-white/5 last:border-0',
        props.lockedHighlight ? 'bg-[var(--accent-dim)]/15 -mx-1 px-1 rounded' : '',
      ].join(' ')}
    >
      <span className={`w-0.5 self-stretch rounded-full shrink-0 ${bar}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={`text-[12px] font-semibold truncate ${rarityHueTextClass(hue)}`}>
          {props.item.name}
        </div>
        <div className="text-[10px] text-[var(--muted)] truncate">
          {props.item.size}
          {props.item.contactPrice > 0 ? ` · ${formatPrice(props.item.contactPrice)}` : ''}
        </div>
      </div>
      <div className="text-[12px] font-bold tabular-nums text-white shrink-0">
        {formatPct(props.item.displayPct)}
      </div>
    </li>
  );
}

export function TacticalResultCard(props: {
  items: ScoredItem[];
  redChancePercent: number;
  soundId: number;
  audioConfidence: number;
  lowConfidence?: boolean;
  isolatedItem?: boolean;
  hideImages?: boolean;
  /** Compact grid for earlier Multi slots */
  compact?: boolean;
  /** Optional subtitle under Red Chance */
  meta?: string;
  children?: ReactNode;
}) {
  const sorted = sortHudItems(props.items);
  const isolatedLock = props.isolatedItem === true && !props.lowConfidence;
  const alone = isolatedLock && sorted.length === 1;
  const redChance = props.redChancePercent;
  const showGrid = sorted.length > 0;

  return (
    <section
      className={[
        'rounded-xl border overflow-hidden',
        'bg-[rgba(8,10,14,0.92)] backdrop-blur-sm',
        props.lowConfidence
          ? 'border-[var(--warn)]/45'
          : redChance > 0
            ? 'border-[var(--mythic)]/40'
            : 'border-[var(--border)]',
        props.compact ? 'p-2.5' : 'p-3 sm:p-4',
      ].join(' ')}
      data-tactical-result="phase3"
      aria-live="polite"
    >
      {/* Red Chance header — TL;DR */}
      <header
        className="flex flex-wrap items-end justify-between gap-2 mb-3"
        data-metric="red-chance"
      >
        <div>
          <div
            className={[
              'font-bold tabular-nums leading-none tracking-tight',
              props.compact ? 'text-2xl' : 'text-4xl sm:text-5xl',
              redChance > 0 ? 'text-white' : 'text-[var(--muted)]',
            ].join(' ')}
          >
            {formatPct(redChance)}
          </div>
          <div
            className={[
              'mt-1 font-semibold uppercase tracking-[0.14em]',
              props.compact ? 'text-[9px]' : 'text-[11px]',
              redChance > 0 ? 'text-[var(--mythic)]' : 'text-[var(--muted)]',
            ].join(' ')}
          >
            Red Chance
          </div>
        </div>
        <div className="text-right space-y-1">
          {props.lowConfidence && (
            <span
              className="inline-block rounded px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide border border-[var(--warn)]/55 bg-[var(--warn)]/15 text-[var(--warn)]"
              data-badge="low-confidence"
            >
              Low Confidence / Best Guess
            </span>
          )}
          {alone && (
            <span className="inline-block rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border border-[var(--accent)]/50 bg-[var(--accent-dim)]/25 text-[var(--accent)]">
              100% locked
            </span>
          )}
          <div className="text-[10px] text-[var(--muted)]">
            Group #{props.soundId} · {props.audioConfidence}% audio
          </div>
          {props.meta && (
            <div className="text-[10px] text-[var(--muted)]">{props.meta}</div>
          )}
        </div>
      </header>

      {!showGrid ? (
        <p className="m-0 text-xs text-[var(--muted)]">No candidates in current filters.</p>
      ) : alone ? (
        /* Confirmed / isolated — single dominant tile */
        <div className="flex justify-center py-2">
          <HudTile
            item={{ ...sorted[0], displayPct: 100 }}
            hideImages={props.hideImages}
            lockedHighlight
          />
        </div>
      ) : (
        <div
          className={[
            'grid gap-3',
            props.compact ? '' : 'lg:grid-cols-[1fr_minmax(11rem,14rem)]',
          ].join(' ')}
        >
          <div
            className={[
              'grid gap-2 justify-items-start',
              props.compact
                ? 'grid-cols-3 sm:grid-cols-4'
                : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5',
            ].join(' ')}
            data-hud-grid
          >
            {sorted.map((item) => (
              <HudTile
                key={item.id}
                item={item}
                hideImages={props.hideImages}
                compact={props.compact}
              />
            ))}
          </div>

          {!props.compact && (
            <ul className="m-0 p-0 list-none border-l border-white/8 pl-3 min-w-0 hidden lg:block">
              {sorted.slice(0, 10).map((item) => (
                <SideRow key={item.id} item={item} />
              ))}
              {sorted.length > 10 && (
                <li className="text-[10px] text-[var(--muted)] pt-1">
                  +{sorted.length - 10} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Mobile / compact side list under grid */}
      {showGrid && !alone && !props.compact && (
        <ul className="m-0 mt-3 p-0 list-none lg:hidden border-t border-white/8 pt-2">
          {sorted.slice(0, 6).map((item) => (
            <SideRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {props.children}
    </section>
  );
}

/** Tiny earlier-slot card for Multi history. */
export function TacticalSlotChip(props: {
  soundId: number;
  confidence: number;
  items: ScoredItem[];
  redChancePercent?: number;
  lowConfidence?: boolean;
  hideImages?: boolean;
  onDismiss?: () => void;
}) {
  const sorted = sortHudItems(props.items);
  const top = sorted[0];
  const hue: RarityHue | null = top ? rarityHue(top) : null;
  const red = props.redChancePercent;

  return (
    <article
      className="rounded-lg border border-[var(--border)] bg-[rgba(8,10,14,0.88)] p-2 flex gap-2 items-center min-w-0"
      data-tactical-slot="earlier"
    >
      {top && (
        <HudTile
          item={top}
          hideImages={props.hideImages}
          compact
        />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={[
            'text-[12px] font-semibold truncate',
            hue ? rarityHueTextClass(hue) : 'text-[var(--text)]',
          ].join(' ')}
        >
          {top?.name ?? `Group #${props.soundId}`}
        </div>
        <div className="text-[10px] text-[var(--muted)]">
          #{props.soundId} · {props.confidence}% audio
          {props.lowConfidence ? ' · guess' : ''}
        </div>
        {red != null && (
          <div
            className={[
              'text-[11px] font-bold tabular-nums',
              red > 0 ? 'text-white' : 'text-[var(--muted)]',
            ].join(' ')}
          >
            {formatPct(red)}{' '}
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--mythic)]">
              red
            </span>
          </div>
        )}
      </div>
      {props.onDismiss && (
        <button
          type="button"
          onClick={props.onDismiss}
          className="text-[11px] text-[var(--muted)] shrink-0"
        >
          ✕
        </button>
      )}
    </article>
  );
}
