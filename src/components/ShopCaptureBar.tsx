/**
 * Primary Field Merchant workflow while audio is capturing:
 * 1) At Shop — calibrate idle baseline (burst-ready; auto off)
 * 2) Single: Move Item → Stop & Match — manual burst capture
 * 3) Dual+Multi: Arm Multi scan — auto-count moves → lock → grid → next cargo
 * Optional: Arm auto-detect (stricter margin) after At Shop (Single)
 */

export function ShopCaptureBar(props: {
  atShop: boolean;
  recordingMove: boolean;
  autoArmed?: boolean;
  calibrating?: boolean;
  busy?: boolean;
  toast?: string | null;
  /** Dual + Multiple Items continuous scan */
  multiMode?: boolean;
  multiArmed?: boolean;
  multiSpikeCount?: number;
  multiTargetN?: number;
  multiPhase?: string;
  /** Object URL for last Stop & Match WAV (playable even when match fails). */
  captureUrl?: string | null;
  captureDurationMs?: number;
  onToggleAtShop: () => void;
  onStartMove: () => void;
  onStopMatch: () => void;
  onToggleAuto?: () => void;
  onArmMulti?: () => void;
  onStopMulti?: () => void;
  onDismissToast?: () => void;
  onPlayCapture?: () => void;
  onDownloadCapture?: () => void;
}) {
  const multi = props.multiMode === true;
  const targetN = props.multiTargetN ?? 3;
  const spikeN = props.multiSpikeCount ?? 0;

  return (
    <section className="rounded border border-[var(--accent)]/40 bg-[var(--bg-elevated)] px-3 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
          Shop capture
        </h2>
        <p className="m-0 text-[10px] text-[var(--muted)]">
          {multi
            ? 'Multi · auto-count moves → grid'
            : 'Burst-only by default · auto-detect optional'}
        </p>
      </div>

      {props.toast && (
        <div
          role="status"
          className="flex items-start justify-between gap-2 rounded border border-[var(--warn)]/50 bg-[#2a2208] px-2.5 py-2 text-[11px] text-[var(--warn)]"
        >
          <p className="m-0 leading-relaxed whitespace-pre-wrap">{props.toast}</p>
          {props.onDismissToast && (
            <button
              type="button"
              onClick={props.onDismissToast}
              className="shrink-0 text-[10px] text-[var(--muted)] hover:text-[var(--text)]"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {props.captureUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2">
          <p className="m-0 text-[11px] text-[var(--muted)]">
            Captured burst
            {props.captureDurationMs != null
              ? ` · ${Math.round(props.captureDurationMs)}ms`
              : ''}{' '}
            — hear whether the site got the cargo noise
          </p>
          <button
            type="button"
            onClick={props.onPlayCapture}
            className="rounded px-2.5 py-1 text-[11px] font-semibold border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            ▶ Play captured audio
          </button>
          <button
            type="button"
            onClick={props.onDownloadCapture}
            className="rounded px-2.5 py-1 text-[11px] font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
          >
            Download WAV
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          disabled={props.busy || props.recordingMove || props.calibrating || props.multiArmed}
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
              ? '✓ At Shop'
              : '1. Click When At Shop'}
        </button>

        {multi ? (
          <>
            {!props.multiArmed ? (
              <button
                type="button"
                disabled={props.busy || props.calibrating || !props.atShop}
                onClick={props.onArmMulti}
                className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110 disabled:opacity-50"
              >
                2. Arm Multi scan
              </button>
            ) : (
              <>
                <span
                  className="rounded px-3 py-1.5 text-[12px] font-bold tabular-nums border border-[var(--accent)] bg-[var(--accent-dim)]/40 text-[var(--text)]"
                  title="Cargo moves detected this item"
                >
                  {spikeN}/{targetN} moves
                  {props.multiPhase === 'cooldown'
                    ? ' · cooldown'
                    : props.multiPhase === 'matching'
                      ? ' · matching…'
                      : ''}
                </span>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={props.onStopMulti}
                  className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33]"
                >
                  Stop Multi
                </button>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={props.onStopMatch}
                  className="rounded px-2.5 py-1.5 text-[11px] font-medium border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                  title="Force match now with current buffer (escape)"
                >
                  Force Stop & Match
                </button>
              </>
            )}
          </>
        ) : !props.recordingMove ? (
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

        {!multi && props.atShop && props.onToggleAuto && (
          <button
            type="button"
            disabled={props.busy || props.recordingMove || props.calibrating}
            onClick={props.onToggleAuto}
            className={[
              'rounded px-2.5 py-1.5 text-[11px] font-medium border',
              props.autoArmed
                ? 'border-[var(--warn)] text-[var(--warn)] bg-[#2a2208]'
                : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]',
            ].join(' ')}
          >
            {props.autoArmed ? 'Auto-detect ON' : 'Arm auto-detect'}
          </button>
        )}
      </div>

      <p className="m-0 text-[11px] leading-relaxed text-[var(--muted)]">
        {!props.atShop && !props.recordingMove && !props.multiArmed && (
          <>
            <strong className="text-[var(--text)]">In Raid (gate closed)</strong> — listening paused;
            footsteps/heals ignored. At the Field Merchant click{' '}
            <strong className="text-[var(--text)]">At Shop</strong>
            {multi ? ', then Arm Multi scan.' : ', then use Move Item → Stop & Match.'}
          </>
        )}
        {multi && props.atShop && !props.multiArmed && (
          <>
            <strong className="text-[var(--text)]">At Shop · Multi ready</strong> — Arm Multi scan,
            then drag each cargo {targetN}× (early lock at 2 if the vote is clear). Locks append to
            the continuous grid; cooldown then waits for the next cargo.
          </>
        )}
        {multi && props.multiArmed && (
          <>
            <strong className="text-[var(--accent)]">Multi armed</strong> — counting moves{' '}
            <strong className="text-[var(--text)]">
              {spikeN}/{targetN}
            </strong>
            . Same pcm300 matcher as Stop & Match. After lock, wait for the next cargo sound.
          </>
        )}
        {!multi && props.atShop && !props.recordingMove && !props.autoArmed && (
          <>
            <strong className="text-[var(--text)]">At Shop · burst-only</strong> — baseline locked;
            auto-onset is <strong className="text-[var(--text)]">off</strong> (heals won’t lock). Prefer
            Start Moving Item → drag cargo → Stop &amp; Match. Optional: Arm auto-detect.
          </>
        )}
        {!multi && props.atShop && !props.recordingMove && props.autoArmed && (
          <>
            <strong className="text-[var(--warn)]">At Shop · auto-detect armed</strong> — stricter
            floor + margin. Heal/ambient with tied scores is rejected; burst Move scan is still safer.
          </>
        )}
        {!multi && props.recordingMove && (
          <>
            <strong className="text-[var(--warn)]">Recording moves…</strong> Drag the same Mystery
            Cargo a few times in-game, then click Stop &amp; Match Item. Raw audio is saved for Play
            even if the match fails.
          </>
        )}
      </p>
    </section>
  );
}
