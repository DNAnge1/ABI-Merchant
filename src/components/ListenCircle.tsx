/**
 * Premium mid-screen state circle for Catch.
 * States: Start Listening → At Shop → Start Moving (red pulse) → Recording/live.
 * Multi: always-visible moveCount/3. Single: burst via Stop & Match.
 */

export type CatchCircleState =
  | 'idle'
  | 'listening'
  | 'at-shop'
  | 'moving'
  | 'matching';

export function ListenCircle(props: {
  capturing: boolean;
  multiMode: boolean;
  multiArmed: boolean;
  moveCount: number;
  targetN?: number;
  multiPhase?: string;
  atShop: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  /** Single: Start Moving / Stop & Match shortcuts under the circle */
  onAtShop?: () => void;
  onStartMove?: () => void;
  onStopMatch?: () => void;
  onArmMulti?: () => void;
  onStopMulti?: () => void;
  recordingMove?: boolean;
  calibrating?: boolean;
  /** Live rolling preview is updating */
  liveNarrowing?: boolean;
}) {
  const targetN = props.targetN ?? 3;
  const moveCount = props.capturing ? props.moveCount : 0;

  const circleState: CatchCircleState = !props.capturing
    ? 'idle'
    : props.multiMode && props.multiPhase === 'matching'
      ? 'matching'
      : props.recordingMove
        ? 'moving'
        : props.atShop
          ? 'at-shop'
          : 'listening';

  const ringClass =
    circleState === 'moving'
      ? 'border-[var(--mythic)] bg-[var(--mythic)]/10 catch-pulse-red'
      : circleState === 'matching'
        ? 'border-[var(--warn)] bg-[var(--warn)]/10'
        : circleState === 'at-shop'
          ? 'border-[var(--ok)] bg-[var(--ok)]/10'
          : circleState === 'listening'
            ? 'border-[var(--listening)] bg-[var(--listening)]/10'
            : 'border-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15';

  const titleClass =
    circleState === 'moving'
      ? 'text-[var(--mythic)]'
      : circleState === 'matching'
        ? 'text-[var(--warn)]'
        : circleState === 'at-shop'
          ? 'text-[var(--ok)]'
          : circleState === 'listening'
            ? 'text-[var(--listening)]'
            : 'text-[var(--accent)]';

  const headline = !props.capturing
    ? 'Start Listening'
    : circleState === 'moving'
      ? props.liveNarrowing
        ? 'Live narrowing…'
        : 'Moving item…'
      : circleState === 'matching'
        ? 'Matching…'
        : circleState === 'at-shop'
          ? 'At Shop'
          : 'Listening';

  const sub =
    !props.capturing
      ? 'Ready at Field Merchant'
      : props.multiMode
        ? props.multiArmed
          ? props.multiPhase === 'matching'
            ? 'Matching…'
            : props.multiPhase === 'cooldown'
              ? 'Cooldown'
              : 'Multi waits for 3'
          : 'Arm Multi, then move 3×'
        : circleState === 'moving'
          ? 'Drag cargo — results update live'
          : circleState === 'at-shop'
            ? 'Start Moving Item when ready'
            : 'At Shop when you reach the merchant';

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg-panel)] px-5 py-5 text-center">
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() =>
            props.capturing ? props.onStopListening() : props.onStartListening()
          }
          className={[
            'w-[180px] h-[180px] rounded-full border-[2.5px] flex flex-col items-center justify-center gap-1.5 p-4',
            ringClass,
          ].join(' ')}
          data-catch-state={circleState}
        >
          <span className={['text-[13px] font-semibold tracking-tight', titleClass].join(' ')}>
            {props.capturing ? 'Stop listening' : 'Start Listening'}
          </span>
          {props.multiMode ? (
            <span className="text-[28px] font-semibold tracking-tight tabular-nums text-[var(--text)]">
              {moveCount}/{targetN}
            </span>
          ) : (
            <span className="text-[17px] font-semibold tracking-tight text-[var(--text)]">
              {headline}
            </span>
          )}
          <span className="text-[10px] font-medium text-[var(--muted)] leading-snug max-w-[140px]">
            {sub}
          </span>
        </button>

        {/* State strip: Burst → At Shop → Start Moving */}
        {props.capturing && !props.multiMode && (
          <ol
            className="m-0 p-0 list-none flex flex-wrap justify-center gap-1.5 text-[10px]"
            aria-label="Scan progress"
          >
            <StateChip active={circleState !== 'idle'} done={circleState !== 'listening' || props.atShop}>
              1 · Burst
            </StateChip>
            <StateChip
              active={circleState === 'at-shop' || circleState === 'moving' || circleState === 'matching'}
              done={circleState === 'moving' || circleState === 'matching'}
            >
              2 · At Shop
            </StateChip>
            <StateChip
              active={circleState === 'moving' || circleState === 'matching'}
              done={circleState === 'matching'}
              hot={circleState === 'moving'}
            >
              3 · Moving
            </StateChip>
          </ol>
        )}

        {props.capturing && (
          <div className="flex flex-wrap justify-center gap-2">
            {props.onAtShop && (
              <button
                type="button"
                disabled={props.calibrating || props.recordingMove || props.multiArmed}
                onClick={props.onAtShop}
                className={[
                  'rounded px-3 py-1.5 text-[11px] font-semibold border',
                  props.atShop
                    ? 'bg-[var(--ok)]/20 border-[var(--ok)] text-[var(--ok)]'
                    : 'bg-[var(--accent)] text-[#041412] border-transparent',
                ].join(' ')}
              >
                {props.calibrating
                  ? 'At Shop…'
                  : props.atShop
                    ? '✓ At Shop'
                    : '1. At Shop'}
              </button>
            )}
            {props.multiMode ? (
              <>
                {!props.multiArmed ? (
                  <button
                    type="button"
                    disabled={!props.atShop || props.calibrating}
                    onClick={props.onArmMulti}
                    className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412] disabled:opacity-50"
                  >
                    2. Arm Multi
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={props.onStopMulti}
                      className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33]"
                    >
                      Stop Multi
                    </button>
                    <button
                      type="button"
                      onClick={props.onStopMatch}
                      className="rounded px-2.5 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)]"
                    >
                      Force Stop & Match
                    </button>
                  </>
                )}
              </>
            ) : !props.recordingMove ? (
              <button
                type="button"
                disabled={props.calibrating}
                onClick={props.onStartMove}
                className={[
                  'rounded px-3 py-1.5 text-[11px] font-semibold border',
                  props.atShop
                    ? 'bg-[var(--mythic)] text-white border-transparent catch-pulse-red-btn'
                    : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]',
                ].join(' ')}
              >
                2. Start Moving Item
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onStopMatch}
                className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33]"
              >
                ■ Stop & Match
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StateChip(props: {
  children: string;
  active?: boolean;
  done?: boolean;
  hot?: boolean;
}) {
  return (
    <li
      className={[
        'rounded-full px-2 py-0.5 border',
        props.hot
          ? 'border-[var(--mythic)]/60 bg-[var(--mythic)]/15 text-[var(--mythic)]'
          : props.done
            ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]'
            : props.active
              ? 'border-[var(--accent)]/50 text-[var(--accent)]'
              : 'border-[var(--border)] text-[var(--muted)]',
      ].join(' ')}
    >
      {props.children}
    </li>
  );
}
