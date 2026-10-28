const SIZES = ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2'] as const;

export function FilterPanel(props: {
  sizes: string[];
  cargoTypes: string[];
  cargoPrices: number[];
  size: string;
  cargoType: string;
  cargoPrice: number | '';
  noiseFloor: number;
  onChange: (patch: {
    size?: string;
    cargoType?: string;
    cargoPrice?: number | '';
    noiseFloor?: number;
  }) => void;
}) {
  const sizeOptions = props.sizes.length ? props.sizes : [...SIZES];

  return (
    <section className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-3">
      <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        Cargo filters
      </h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--muted)]">
          Size
          <select
            value={props.size}
            onChange={(e) => props.onChange({ size: e.target.value })}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            <option value="">Any</option>
            {sizeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--muted)]">
          Cargo type
          <select
            value={props.cargoType}
            onChange={(e) => props.onChange({ cargoType: e.target.value })}
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            <option value="">Any</option>
            {props.cargoTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--muted)]">
          Cargo price
          <select
            value={props.cargoPrice === '' ? '' : String(props.cargoPrice)}
            onChange={(e) =>
              props.onChange({
                cargoPrice: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            <option value="">Any</option>
            {props.cargoPrices.map((p) => (
              <option key={p} value={p}>
                {p.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => props.onChange({ size: props.size === s ? '' : s })}
            className={[
              'rounded px-2 py-1 text-[11px] border',
              props.size === s
                ? 'border-[var(--accent)] bg-[var(--accent-dim)]/50 text-[var(--text)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent-dim)]',
            ].join(' ')}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="mt-3 flex flex-col gap-1 text-[11px] text-[var(--muted)]">
        Onset noise floor ({props.noiseFloor.toFixed(2)})
        <input
          type="range"
          min={0.05}
          max={0.5}
          step={0.01}
          value={props.noiseFloor}
          onChange={(e) => props.onChange({ noiseFloor: Number(e.target.value) })}
          className="w-full"
        />
      </label>
    </section>
  );
}
