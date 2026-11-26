import { useEffect, useMemo, useState } from 'react';
import type { MerchantItem } from '../utils/audioMatcher';

export function MissFeedbackModal(props: {
  open: boolean;
  predictedSoundId: number;
  items: MerchantItem[];
  onCancel: () => void;
  onSubmit: (actual: { soundId: number; itemId?: number; itemName?: string }) => void;
  /** Optional local WAV download (never uploaded). */
  onDownloadWav?: () => void;
  hasCaptureWav?: boolean;
}) {
  /** Actual pick starts empty so it is not confused with Predicted lock. */
  const [soundId, setSoundId] = useState<number | ''>('');
  const [itemId, setItemId] = useState<number | ''>('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setSoundId('');
    setItemId('');
    setSending(false);
  }, [props.open, props.predictedSoundId]);

  const soundOptions = useMemo(() => {
    const ids = Array.from(new Set(props.items.map((i) => i.soundId))).sort((a, b) => a - b);
    return ids.length ? ids : Array.from({ length: 38 }, (_, i) => i + 1);
  }, [props.items]);

  const itemsForSound = useMemo(
    () =>
      soundId === ''
        ? []
        : props.items.filter((i) => i.soundId === soundId),
    [props.items, soundId],
  );

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Report issue"
      data-report-issue-modal
    >
      <div className="w-full max-w-md rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-xl">
        <h3 className="m-0 text-sm font-semibold text-[var(--text)]">Report issue</h3>
        <p className="m-0 mt-1 text-[11px] text-[var(--muted)] leading-snug">
          Bound to the <strong className="text-[var(--text)]">final Stop &amp; Match lock</strong>
          — not the live narrowing peek.
        </p>
        <div
          className="mt-2 rounded border border-[var(--accent)]/40 bg-[var(--accent-dim)]/15 px-2.5 py-1.5 text-[12px] text-[var(--text)]"
          data-predicted-lock
        >
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Predicted lock
          </span>
          <div className="font-semibold tabular-nums">Group #{props.predictedSoundId}</div>
        </div>
        <p className="m-0 mt-2 text-[11px] text-[var(--muted)] leading-snug">
          Pick what you actually got, then Send. We upload diagnostics only (top 5, expected
          rank, onset/RMS, map/mode) —{' '}
          <strong className="text-[var(--text)]">no audio leaves your device</strong>.
        </p>

        {props.hasCaptureWav && props.onDownloadWav && (
          <button
            type="button"
            onClick={props.onDownloadWav}
            className="mt-3 w-full rounded-lg px-3 py-2 text-[11px] font-semibold border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
          >
            Download WAV (hear what was captured — stays on your PC)
          </button>
        )}

        <label className="mt-3 flex flex-col gap-1 text-[11px] text-[var(--muted)]">
          Actual Group # (what you really got)
          <select
            value={soundId === '' ? '' : String(soundId)}
            onChange={(e) => {
              setSoundId(e.target.value === '' ? '' : Number(e.target.value));
              setItemId('');
            }}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            <option value="">— pick actual —</option>
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
            disabled={sending || soundId === ''}
            onClick={() => {
              if (soundId === '') return;
              const item = itemsForSound.find((i) => i.id === itemId);
              setSending(true);
              props.onSubmit({
                soundId,
                itemId: item?.id,
                itemName: item?.name,
              });
            }}
            className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--mythic)] text-white disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
}
