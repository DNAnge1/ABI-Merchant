/**
 * Premium mid-screen teal-ring CTA: Start/Stop Listening + always-visible moveCount/3.
 */
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
}) {
  const targetN = props.targetN ?? 3;
  const moveCount = props.capturing ? props.moveCount : 0;

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg-panel)] px-5 py-7 text-center">
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() =>
            props.capturing ? props.onStopListening() : props.onStartListening()
          }
          className={[
            'w-[196px] h-[196px] rounded-full border-[2.5px] flex flex-col items-center justify-center gap-1.5 p-4',
            props.capturing
              ? 'border-[var(--listening)] bg-[var(--listening)]/10'
              : 'border-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15',
          ].join(' ')}
        >
          <span
            className={[
              'text-[15px] font-semibold tracking-tight',
              props.capturing ? 'text-[var(--listening)]' : 'text-[var(--accent)]',
            ].join(' ')}
          >
            {props.capturing ? 'Stop listening' : 'Start Listening'}
          </span>
          <span className="text-[28px] font-semibold tracking-tight tabular-nums text-[var(--text)]">
            {moveCount}/{targetN}
          </span>
          <span className="text-[10px] font-medium text-[var(--muted)] leading-snug max-w-[140px]">
            {props.capturing
              ? props.multiMode
                ? props.multiArmed
                  ? props.multiPhase === 'matching'
                    ? 'Matching…'
                    : props.multiPhase === 'cooldown'
                      ? 'Cooldown'
                      : 'Multi waits for 3'
                  : 'Arm Multi in shop bar'
                : props.recordingMove
                  ? 'Recording moves…'
                  : 'Ready at Field Merchant'
              : 'Ready at Field Merchant'}
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
                className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
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
