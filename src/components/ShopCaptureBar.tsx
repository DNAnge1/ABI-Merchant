/**
 * Primary Field Merchant workflow while audio is capturing:
 * 1) At Shop — calibrate idle baseline / open gate
 * 2) Move Item → Stop & Match — manual burst capture
 */

export function ShopCaptureBar(props: {
  atShop: boolean;
  recordingMove: boolean;
  calibrating?: boolean;
  busy?: boolean;
  onToggleAtShop: () => void;
  onStartMove: () => void;
  onStopMatch: () => void;
}) {
  return (
    <section className="rounded border border-[var(--accent)]/40 bg-[var(--bg-elevated)] px-3 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
          Shop capture
        </h2>
        <p className="m-0 text-[10px] text-[var(--muted)]">
          Primary workflow · auto-onset optional after At Shop
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.busy || props.recordingMove || props.calibrating}
          onClick={props.onToggleAtShop}
          className={[
            'rounded px-3 py-1.5 text-[11px] font-semibold border',
            props.atShop
              ? 'bg-[var(--ok)]/20 border-[var(--ok)] text-[var(--ok)]'
              : 'bg-[var(--accent)] text-[#041412] border-transparent hover:brightness-110',
          ].join(' ')}
        >
          {props.calibrating
            ? 'At Shop (calibrating…)'
            : props.atShop
              ? '✓ At Shop (Listening Active)'
              : '1. Click When At Shop'}
        </button>

        {!props.recordingMove ? (
          <button
            type="button"
            disabled={props.busy || props.calibrating}
            onClick={props.onStartMove}
            className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
          >
            2. Start Moving Item
          </button>
        ) : (
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onStopMatch}
            className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33]"
          >
            ■ Stop & Match Item
          </button>
        )}
      </div>

      <p className="m-0 text-[11px] leading-relaxed text-[var(--muted)]">
        {!props.atShop && !props.recordingMove && (
          <>
            <strong className="text-[var(--text)]">In Raid (gate closed)</strong> — Start Listening
            anytime; raid/footstep noise is ignored until you are at the Field Merchant and click{' '}
            <strong className="text-[var(--text)]">At Shop</strong> or{' '}
            <strong className="text-[var(--text)]">Start Moving Item</strong>.
          </>
        )}
        {props.atShop && !props.recordingMove && (
          <>
            <strong className="text-[var(--text)]">At Shop (open)</strong> — shop baseline locked.
            Prefer <strong className="text-[var(--text)]">Manual Move Scan</strong> (Start Moving
            Item → drag cargo a few times → Stop & Match). Optional auto-onset is also armed.
          </>
        )}
        {props.recordingMove && (
          <>
            <strong className="text-[var(--warn)]">Recording moves…</strong> Drag the same Mystery
            Cargo a few times in-game, then click Stop & Match Item.
          </>
        )}
      </p>
    </section>
  );
}
