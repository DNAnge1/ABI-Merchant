import { useMemo, useState } from 'react';
import type { MerchantItem } from '../utils/audioMatcher';

export function MissFeedbackModal(props: {
  open: boolean;
  predictedSoundId: number;
  items: MerchantItem[];
  onCancel: () => void;
  onSubmit: (actual: { soundId: number; itemId?: number; itemName?: string }) => void;
}) {
  const [soundId, setSoundId] = useState(props.predictedSoundId);
  const [itemId, setItemId] = useState<number | ''>('');

  const soundOptions = useMemo(() => {
    const ids = Array.from(new Set(props.items.map((i) => i.soundId))).sort((a, b) => a - b);
    return ids.length ? ids : Array.from({ length: 38 }, (_, i) => i + 1);
  }, [props.items]);

  const itemsForSound = useMemo(
    () => props.items.filter((i) => i.soundId === soundId),
    [props.items, soundId],
  );

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-xl">
        <h3 className="m-0 text-sm font-semibold text-[var(--text)]">What was it actually?</h3>
        <p className="m-0 mt-1 text-[11px] text-[var(--muted)]">
          Predicted Group #{props.predictedSoundId}. Pick the real Sound Group (1–38) and optional
          item — we log the miss + spectral snapshot for calibration.
        </p>

        <label className="mt-3 flex flex-col gap-1 text-[11px] text-[var(--muted)]">
          Actual Group #
          <select
            value={soundId}
            onChange={(e) => {
              setSoundId(Number(e.target.value));
              setItemId('');
            }}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            {soundOptions.map((id) => (
              <option key={id} value={id}>
                Group {id}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-2 flex flex-col gap-1 text-[11px] text-[var(--muted)]">
          Item (optional)
          <select
            value={itemId === '' ? '' : String(itemId)}
            onChange={(e) => setItemId(e.target.value === '' ? '' : Number(e.target.value))}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            <option value="">Unknown / not sure</option>
            {itemsForSound.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.size}, {i.contactPrice.toLocaleString()} Koen)
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded px-3 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const item = itemsForSound.find((i) => i.id === itemId);
              props.onSubmit({
                soundId,
                itemId: item?.id,
                itemName: item?.name,
              });
            }}
            className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--mythic)] text-white"
          >
            Log miss
          </button>
        </div>
      </div>
    </div>
  );
}
