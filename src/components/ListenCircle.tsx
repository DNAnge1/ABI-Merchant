/**
 * One-stop Start Scan control: circle = Start / Stop Listening.
 * Secondary At Shop / Move actions stay under the circle (no Burst→Moving theater).
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
  /** Single: At Shop / Start Moving / Stop & Match under the circle */
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

  // One clear label — never "Start Listening" twice (eyebrow + headline).
  const label = !props.capturing
    ? 'Start Listening'
    : circleState === 'moving'
      ? props.liveNarrowing
        ? 'Live narrowing…'
        : 'Moving…'
      : circleState === 'matching'
        ? 'Matching…'
        : circleState === 'at-shop'
          ? 'At Shop'
          : 'Stop Listening';

  const cue = !props.capturing
    ? 'Be at the Field Merchant shop before starting'
    : props.multiMode
      ? props.multiArmed
        ? props.multiPhase === 'matching'
          ? 'Matching moves…'
          : props.multiPhase === 'cooldown'
            ? 'Cooldown'
            : `Multi · ${moveCount}/${targetN}`
        : 'Arm Multi, then move 3×'
      : circleState === 'moving'
        ? 'Drag cargo — results update live'
        : circleState === 'at-shop'
          ? 'Start Moving Item when ready'
          : 'Tap At Shop when you reach the merchant';

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
          aria-label={props.capturing ? 'Stop Listening' : 'Start Listening'}
        >
          <span className={['text-[17px] font-semibold tracking-tight', titleClass].join(' ')}>
            {label}
          </span>
          {props.multiMode && props.capturing && (
            <span className="text-[28px] font-semibold tracking-tight tabular-nums text-[var(--text)]">
              {moveCount}/{targetN}
            </span>
          )}
          <span className="text-[10px] font-medium text-[var(--muted)] leading-snug max-w-[140px]">
            {cue}
          </span>
        </button>

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
                    : 'At Shop'}
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
                    Arm Multi
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
                Start Moving Item
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
