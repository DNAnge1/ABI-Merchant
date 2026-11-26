import type { MapModeOption } from '../utils/raidPools';
import { formatKoen } from '../utils/raidPools';

/**
 * Sticky raid context: map/mode + cargo type/price while listening or in Manual.
 * Keeps teal shell; compact so it doesn't fight the tactical HUD.
 */
export function RaidContextBar(props: {
  mapModes: MapModeOption[];
  cargoTypes: string[];
  cargoPrices: number[];
  mapModeId: string;
  cargoType: string;
  cargoPrice: number | '';
  sticky?: boolean;
  onChange: (patch: {
    mapModeId?: string;
    cargoType?: string;
    cargoPrice?: number | '';
  }) => void;
}) {
  const profileHint = props.mapModes.find((m) => m.id === props.mapModeId);

  return (
    <section
      className={[
        'rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]/95 px-3 py-2.5',
        props.sticky ? 'sticky top-0 z-20 backdrop-blur-sm shadow-sm' : '',
      ].join(' ')}
      data-raid-context
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Raid context
        </h2>
        {profileHint && (
          <span className="text-[10px] tabular-nums text-[var(--accent)]">
            Pool {profileHint.profileId}
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Map / mode
          </span>
          <select
            value={props.mapModeId}
            onChange={(e) => props.onChange({ mapModeId: e.target.value })}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)]"
          >
            <option value="">Any map (avg pools)</option>
            {props.mapModes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Cargo type
          </span>
          <select
            value={props.cargoType}
            onChange={(e) => props.onChange({ cargoType: e.target.value })}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)]"
          >
            <option value="">Any type</option>
            {props.cargoTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Cargo price
          </span>
          <select
            value={props.cargoPrice === '' ? '' : String(props.cargoPrice)}
            onChange={(e) =>
              props.onChange({
                cargoPrice: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)]"
          >
            <option value="">Any price</option>
            {props.cargoPrices.map((p) => (
              <option key={p} value={p}>
                {formatKoen(p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="m-0 mt-2 text-[10px] text-[var(--muted)] leading-snug">
        Odds and EV use explorer pool weights for this raid. Leave Any if you are unsure —
        results still work from sound + size.
      </p>
    </section>
  );
}
