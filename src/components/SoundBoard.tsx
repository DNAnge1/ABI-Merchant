import { playReferenceSound, type MerchantItem } from '../utils/audioMatcher';

export interface SoundProfile {
  soundId: number;
  pickupSound: string;
  dropSound: string;
  pickupFile: string;
  dropFile: string;
  itemNames: string[];
}

export function SoundBoard(props: {
  sounds: SoundProfile[];
  items: MerchantItem[];
  activeSoundId?: number | null;
  onPickSound: (soundId: number) => void;
}) {
  return (
    <section className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Sound board ({props.sounds.length})
        </h2>
        <span className="text-[10px] text-[var(--muted)]">Manual fallback</span>
      </div>
      <div className="mt-2 max-h-[28rem] overflow-auto grid gap-1">
        {props.sounds.map((s) => {
          const active = props.activeSoundId === s.soundId;
          const mythicHit = props.items.some(
            (i) => i.soundId === s.soundId && i.rarity >= 6,
          );
          return (
            <div
              key={s.soundId}
              className={[
                'flex items-center gap-2 rounded border px-2 py-1.5',
                active
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)]/30'
                  : 'border-[var(--border)] bg-[var(--bg)]/60',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => props.onPickSound(s.soundId)}
                className="shrink-0 w-14 text-left text-[11px] font-semibold text-[var(--text)] hover:text-[var(--accent)]"
                title={s.itemNames.slice(0, 6).join(', ')}
              >
                ID {s.soundId}
                {mythicHit && <span className="ml-1 text-[var(--mythic)]">◆</span>}
              </button>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[10px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-dim)]"
                onClick={() => playReferenceSound(s.pickupFile)}
              >
                Pick up
              </button>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[10px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-dim)]"
                onClick={() => playReferenceSound(s.dropFile)}
              >
                Drop
              </button>
              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--muted)]">
                {s.itemNames.slice(0, 3).join(' · ')}
                {s.itemNames.length > 3 ? ` +${s.itemNames.length - 3}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
