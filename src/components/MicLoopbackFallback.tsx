import { useCallback, useEffect, useState } from 'react';
import {
  ensureMicPermission,
  listAudioInputDevices,
  LOOPBACK_SETUP_STEPS,
  type AudioInputDevice,
} from '../utils/micCapture';

export function MicLoopbackFallback(props: {
  /** Emphasize when screen-share NotReadableError just happened */
  prominent?: boolean;
  busy?: boolean;
  onUseDevice: (deviceId: string | undefined) => void;
}) {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selected, setSelected] = useState<string>('default');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      await ensureMicPermission();
      const list = await listAudioInputDevices();
      setDevices(list);
      if (list.length && !list.some((d) => d.deviceId === selected)) {
        setSelected(list[0].deviceId);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    if (props.prominent) void refresh();
  }, [props.prominent, refresh]);

  return (
    <div
      className={[
        'mt-3 rounded px-3 py-3 space-y-2',
        props.prominent
          ? 'border-2 border-[var(--accent)] bg-[var(--accent-dim)]/25'
          : 'border border-[var(--border)] bg-[var(--bg-elevated)]',
      ].join(' ')}
    >
      <div>
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
          {props.prominent
            ? 'Fallback — use microphone / loopback'
            : 'Alternative — microphone / loopback'}
        </p>
        <p className="m-0 mt-1 text-[12px] text-[var(--text)] leading-relaxed">
          Screen + system audio failed (or you prefer this path). Route game audio into a Chrome input
          (VB-Cable, Stereo Mix, etc.), then start Automatic Listening the same way.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 min-w-[12rem] flex-1 text-[11px] text-[var(--muted)]">
          Input device
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)]"
          >
            <option value="default">Default microphone</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || props.busy}
          className="rounded px-2.5 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
        >
          {loading ? 'Listing…' : 'Refresh devices'}
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() =>
            props.onUseDevice(selected === 'default' ? undefined : selected)
          }
          className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110 disabled:opacity-50"
        >
          Use microphone / loopback
        </button>
      </div>

      {listError && (
        <p className="m-0 text-[11px] text-[var(--mythic-gold)]">{listError}</p>
      )}

      <details className="rounded border border-[var(--border)]/80 bg-[var(--bg)]/40 px-2.5 py-1.5" open={props.prominent}>
        <summary className="cursor-pointer text-[11px] font-semibold text-[var(--muted)]">
          How to route game audio into Chrome
        </summary>
        <ul className="m-0 mt-2 pl-4 space-y-2 text-[11px] text-[var(--text)] leading-relaxed">
          {LOOPBACK_SETUP_STEPS.map((s) => (
            <li key={s.title}>
              <strong className="text-[var(--accent)]">{s.title}:</strong> {s.body}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
