const SIZES = ['1x1', '1x2', '2x1', '2x2', '2x3', '3x2'] as const;

export function ManualFilters(props: {
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
        Manual filters
      </h2>
      <p className="m-0 mt-1 text-[10px] text-[var(--muted)]">
        Optional — narrow the pool when picking by ear. Automatic Mode ignores these.
      </p>

      <div className="mt-2">
        <p className="m-0 mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">Size</p>
        <div className="flex flex-wrap gap-1.5">
          <Pill
            active={!props.size}
            onClick={() => props.onChange({ size: '' })}
            label="Any"
          />
          {sizeOptions.map((s) => (
            <Pill
              key={s}
              active={props.size === s}
              onClick={() => props.onChange({ size: props.size === s ? '' : s })}
              label={s}
            />
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="m-0 mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
          Cargo type
        </p>
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-auto">
          <Pill
            active={!props.cargoType}
            onClick={() => props.onChange({ cargoType: '' })}
            label="Any"
          />
          {props.cargoTypes.map((t) => (
            <Pill
              key={t}
              active={props.cargoType === t}
              onClick={() => props.onChange({ cargoType: props.cargoType === t ? '' : t })}
              label={t}
            />
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="m-0 mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
          Cargo price
        </p>
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-auto">
          <Pill
            active={props.cargoPrice === ''}
            onClick={() => props.onChange({ cargoPrice: '' })}
            label="Any"
          />
          {props.cargoPrices.map((p) => (
            <Pill
              key={p}
              active={props.cargoPrice === p}
              onClick={() =>
                props.onChange({ cargoPrice: props.cargoPrice === p ? '' : p })
              }
              label={p.toLocaleString()}
            />
          ))}
        </div>
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

function Pill(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'rounded px-2 py-1 text-[11px] border',
        props.active
          ? 'border-[var(--accent)] bg-[var(--accent-dim)]/50 text-[var(--text)]'
          : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent-dim)]',
      ].join(' ')}
    >
      {props.label}
    </button>
  );
}
