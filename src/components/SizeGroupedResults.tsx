import type { MatchResult, MerchantItem } from '../utils/audioMatcher';
import {
  cargoPriceTiers,
  groupItemsBySize,
  redLikelihoodPercent,
  type SizeGroup,
} from '../utils/sizeGroups';

const RARITY_LABEL: Record<number, string> = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Epic',
  5: 'Legendary',
  6: 'Mythic',
};

function SizeCard(props: { group: SizeGroup }) {
  const { group } = props;
  return (
    <article
      className={[
        'rounded border p-3 min-w-0',
        group.redPct > 0
          ? 'border-[var(--mythic)]/45 bg-gradient-to-b from-[#241016] to-[var(--bg-panel)]'
          : 'border-[var(--border)] bg-[var(--bg-panel)]',
      ].join(' ')}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-sm font-semibold text-[var(--text)]">
            Size {group.size}
            {group.rotationOf && (
              <span className="ml-2 text-[10px] font-normal text-[var(--muted)]">
                rotation of {group.rotationOf}
              </span>
            )}
          </h3>
          <p className="m-0 mt-0.5 text-[10px] text-[var(--muted)]">
            {group.items.length} candidate{group.items.length === 1 ? '' : 's'} · {group.redCount}{' '}
            Red
          </p>
        </div>
        <div className="text-right">
          <div
            className={[
              'text-2xl font-bold tabular-nums leading-none',
              group.redPct > 0 ? 'text-[var(--mythic)]' : 'text-[var(--muted)]',
            ].join(' ')}
          >
            {group.redPct}%
          </div>
          <div className="text-[9px] uppercase tracking-wide text-[var(--mythic-gold)] font-semibold">
            Red chance
          </div>
        </div>
      </header>

      <ul className="m-0 mt-2.5 p-0 list-none grid gap-1.5">
        {group.items.map((item) => {
          const mythic = item.rarity >= 6;
          const tiers = cargoPriceTiers(item);
          return (
            <li
              key={item.id}
              className={[
                'flex gap-2 rounded border px-2 py-1.5',
                mythic
                  ? 'border-[var(--mythic)]/45 bg-[#1a0c10]'
                  : 'border-[var(--border)] bg-[var(--bg)]/50',
              ].join(' ')}
            >
              {item.iconUrl ? (
                <img
                  src={item.iconUrl}
                  alt=""
                  className="h-10 w-10 object-contain rounded bg-black/30 shrink-0"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-10 w-10 rounded bg-black/30 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={[
                      'text-xs font-semibold',
                      mythic ? 'text-[var(--mythic-gold)]' : 'text-[var(--text)]',
                    ].join(' ')}
                  >
                    {item.name}
                  </span>
                  {mythic && (
                    <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase bg-[var(--mythic)] text-white">
                      RED
                    </span>
                  )}
                </div>
                <p className="m-0 text-[10px] text-[var(--muted)]">
                  {RARITY_LABEL[item.rarity] || `R${item.rarity}`} · {item.category}
                </p>
                {tiers.length > 0 && (
                  <p className="m-0 mt-0.5 text-[10px] text-[var(--muted)]">
                    Cargo tiers:{' '}
                    <span className="text-[var(--text)]">
                      {tiers.map((p) => p.toLocaleString()).join(' · ')}
                    </span>
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-semibold tabular-nums text-[var(--accent)]">
                  {item.contactPrice.toLocaleString()}
                </div>
                <div className="text-[9px] uppercase text-[var(--muted)]">Koen</div>
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

export function SizeGroupedResults(props: {
  soundId: number;
  items: MerchantItem[];
  matchConfidence?: number;
  matchKind?: string;
  altMatches?: MatchResult[];
  onPickAlt?: (soundId: number) => void;
  onClear?: () => void;
  modeLabel?: string;
}) {
  const groups = groupItemsBySize(props.items);
  const overallRed = redLikelihoodPercent(props.items);

  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      <div
        className={[
          'rounded border px-3 py-3',
          overallRed > 0
            ? 'border-[var(--mythic)]/50 bg-gradient-to-r from-[#2a1014] to-[var(--bg-elevated)]'
            : 'border-[var(--border)] bg-[var(--bg-elevated)]',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="m-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {props.modeLabel || 'Match'} · Sound ID {props.soundId}
              {props.matchKind ? ` · ${props.matchKind}` : ''}
            </p>
            <div className="mt-1 flex flex-wrap items-end gap-5">
              <div>
                <div
                  className={[
                    'text-3xl font-bold tabular-nums leading-none',
                    overallRed > 0 ? 'text-[var(--mythic)]' : 'text-[var(--muted)]',
                  ].join(' ')}
                >
                  {overallRed}%
                </div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mythic-gold)]">
                  Overall Red / Mythic
                </div>
                <p className="m-0 mt-0.5 text-[10px] text-[var(--muted)]">
                  {props.items.filter((i) => i.rarity >= 6).length} of {props.items.length} items
                  across {groups.length} size group{groups.length === 1 ? '' : 's'}
                </p>
              </div>
              {props.matchConfidence != null && (
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-[var(--accent)] leading-none">
                    {props.matchConfidence}%
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">Audio match</div>
                </div>
              )}
            </div>
          </div>
          {props.onClear && (
            <button
              type="button"
              onClick={props.onClear}
              className="text-[11px] text-[var(--accent)] hover:underline"
            >
              Clear result
            </button>
          )}
        </div>

        {props.altMatches && props.altMatches.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-[var(--muted)]">Also close:</span>
            {props.altMatches.slice(1, 6).map((m) => (
              <button
                key={m.soundId}
                type="button"
                onClick={() => props.onPickAlt?.(m.soundId)}
                className="rounded px-2 py-0.5 text-[10px] border border-[var(--border)] hover:border-[var(--accent)]"
              >
                #{m.soundId} {m.confidence}%
              </button>
            ))}
          </div>
        )}
      </div>

      {!groups.length ? (
        <p className="m-0 text-xs text-[var(--muted)]">No items mapped to this Sound ID.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <SizeCard key={g.size} group={g} />
          ))}
        </div>
      )}
    </section>
  );
}
