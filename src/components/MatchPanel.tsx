import type { MatchResult, MerchantItem } from '../utils/audioMatcher';

const RARITY_LABEL: Record<number, string> = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Epic',
  5: 'Legendary',
  6: 'Mythic',
};

/** Equal-weight P(item is Mythic/Red) among filtered candidates for a sound. */
export function redLikelihoodPercent(candidates: MerchantItem[]): number {
  if (!candidates.length) return 0;
  const reds = candidates.filter((i) => i.rarity >= 6).length;
  return Math.round((reds / candidates.length) * 1000) / 10;
}

export function sortCandidatesRedsFirst(candidates: MerchantItem[]): MerchantItem[] {
  return [...candidates].sort(
    (a, b) => b.rarity - a.rarity || b.contactPrice - a.contactPrice || a.name.localeCompare(b.name),
  );
}

export function MatchPanel(props: {
  soundId: number;
  matchConfidence?: number;
  matchKind?: string;
  candidates: MerchantItem[];
  altMatches?: MatchResult[];
  onPickAlt?: (soundId: number) => void;
  onClear?: () => void;
}) {
  const sorted = sortCandidatesRedsFirst(props.candidates);
  const reds = sorted.filter((i) => i.rarity >= 6);
  const redPct = redLikelihoodPercent(props.candidates);
  const hasMatchConf = props.matchConfidence != null;

  return (
    <section
      className={[
        'rounded border p-3',
        redPct > 0
          ? 'border-[var(--mythic)]/60 bg-gradient-to-br from-[#2a1014] via-[var(--bg-elevated)] to-[var(--bg-panel)]'
          : 'border-[var(--border)] bg-[var(--bg-elevated)]',
      ].join(' ')}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Grab result · Sound ID {props.soundId}
            {props.matchKind ? ` · ${props.matchKind}` : ''}
          </p>
          <div className="mt-1 flex flex-wrap items-end gap-4">
            <div>
              <div
                className={[
                  'text-3xl font-bold leading-none tabular-nums',
                  redPct > 0 ? 'text-[var(--mythic)]' : 'text-[var(--muted)]',
                ].join(' ')}
              >
                {redPct}%
              </div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mythic-gold)]">
                Red / Mythic chance
              </div>
              <p className="m-0 mt-0.5 text-[10px] text-[var(--muted)]">
                {reds.length} of {props.candidates.length} candidate
                {props.candidates.length === 1 ? '' : 's'} under current size/price filters
              </p>
            </div>
            {hasMatchConf && (
              <div>
                <div className="text-2xl font-semibold leading-none tabular-nums text-[var(--accent)]">
                  {props.matchConfidence}%
                </div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">Audio match confidence</div>
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
          {props.altMatches.slice(1, 5).map((m) => (
            <button
              key={m.soundId}
              type="button"
              onClick={() => props.onPickAlt?.(m.soundId)}
              className="rounded px-2 py-0.5 text-[10px] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
            >
              #{m.soundId} {m.confidence}%
            </button>
          ))}
        </div>
      )}

      <h3 className="m-0 mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        Exact candidates {reds.length > 0 ? '(Reds first)' : ''}
      </h3>

      {!sorted.length ? (
        <p className="m-0 mt-2 text-xs text-[var(--muted)]">
          No items for this sound under the current cargo filters.
        </p>
      ) : (
        <ul className="m-0 mt-2 p-0 list-none grid gap-1.5">
          {sorted.map((item) => {
            const mythic = item.rarity >= 6;
            return (
              <li
                key={item.id}
                className={[
                  'flex items-center gap-2 rounded border px-2 py-1.5',
                  mythic
                    ? 'border-[var(--mythic)]/50 bg-[#1f0c10]'
                    : 'border-[var(--border)] bg-[var(--bg)]/50',
                ].join(' ')}
              >
                {item.iconUrl ? (
                  <img
                    src={item.iconUrl}
                    alt=""
                    className="h-9 w-9 object-contain rounded bg-black/30 shrink-0"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-9 w-9 rounded bg-black/30 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={[
                        'text-xs font-semibold truncate',
                        mythic ? 'text-[var(--mythic-gold)]' : 'text-[var(--text)]',
                      ].join(' ')}
                    >
                      {item.name}
                    </span>
                    {mythic && (
                      <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase bg-[var(--mythic)] text-white">
                        RED
                      </span>
                    )}
                  </div>
                  <p className="m-0 text-[10px] text-[var(--muted)]">
                    {RARITY_LABEL[item.rarity] || `R${item.rarity}`} · {item.size} · {item.category}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-semibold tabular-nums text-[var(--accent)]">
                    {item.contactPrice.toLocaleString()}
                  </div>
                  <div className="text-[9px] uppercase tracking-wide text-[var(--muted)]">Koen</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
