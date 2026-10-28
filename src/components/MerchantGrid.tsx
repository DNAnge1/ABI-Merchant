import type { MerchantItem } from '../utils/audioMatcher';

const RARITY_LABEL: Record<number, string> = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Epic',
  5: 'Legendary',
  6: 'Mythic',
};

function rarityClass(rarity: number) {
  if (rarity >= 6) return 'mythic';
  if (rarity === 5) return 'legendary';
  if (rarity === 4) return 'epic';
  return 'normal';
}

export function MerchantGrid(props: {
  items: MerchantItem[];
  highlightedSoundId?: number | null;
  confidences?: Record<number, number>;
  onSelectItem?: (item: MerchantItem) => void;
  /** Label contact price as Koen (player currency). */
  showKoen?: boolean;
}) {
  if (!props.items.length) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
        No candidates for the current filters. Adjust size / price / type.
      </div>
    );
  }

  return (
    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {props.items.map((item) => {
        const mythic = item.rarity >= 6;
        const hit = props.highlightedSoundId === item.soundId;
        const conf = props.confidences?.[item.soundId];
        const tone = rarityClass(item.rarity);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onSelectItem?.(item)}
            className={[
              'text-left rounded border p-2 transition-all',
              mythic
                ? 'border-[var(--mythic)]/70 bg-gradient-to-br from-[#2a1216] to-[#1a1608]'
                : 'border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--accent-dim)]',
              hit ? 'ring-2 ring-[var(--accent)] scale-[1.01]' : '',
            ].join(' ')}
          >
            <div className="flex gap-2">
              {item.iconUrl ? (
                <img
                  src={item.iconUrl}
                  alt=""
                  className="h-12 w-12 object-contain rounded bg-black/30 shrink-0"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-12 w-12 rounded bg-black/30 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-1">
                  <h3
                    className={[
                      'm-0 text-xs font-semibold truncate',
                      mythic ? 'text-[var(--mythic-gold)]' : 'text-[var(--text)]',
                    ].join(' ')}
                  >
                    {item.name}
                  </h3>
                  {mythic && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-[var(--mythic)] text-white">
                      Mythic
                    </span>
                  )}
                </div>
                <p className="m-0 mt-0.5 text-[10px] text-[var(--muted)]">
                  <span
                    className={
                      tone === 'mythic'
                        ? 'text-[var(--mythic)]'
                        : tone === 'legendary'
                          ? 'text-[#c084fc]'
                          : tone === 'epic'
                            ? 'text-[#60a5fa]'
                            : ''
                    }
                  >
                    {RARITY_LABEL[item.rarity] || `R${item.rarity}`}
                  </span>
                  {' · '}
                  {item.size}
                  {' · '}
                  Sound {item.soundId}
                </p>
                <p className="m-0 mt-1 text-[11px]">
                  {props.showKoen ? 'Koen' : 'Contact'}{' '}
                  <span className="text-[var(--accent)] font-medium tabular-nums">
                    {item.contactPrice.toLocaleString()}
                  </span>
                  {conf != null && (
                    <span className="ml-2 text-[var(--ok)] font-semibold">{conf}%</span>
                  )}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
