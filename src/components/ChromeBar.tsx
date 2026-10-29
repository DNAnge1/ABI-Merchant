export function ChromeBar(props: {
  mode: 'automatic' | 'manual';
  screen: 'entry' | 'wizard' | 'listen' | 'manual' | 'troubleshooting';
  capturing: boolean;
  onStartOver: () => void;
  onModeChange: (mode: 'automatic' | 'manual') => void;
  onOpenTrouble: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
}) {
  const autoActive = props.mode === 'automatic' && props.screen !== 'manual';
  const showListenToggle =
    props.mode === 'automatic' &&
    (props.screen === 'listen' || props.screen === 'wizard');

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur-sm px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="m-0 text-sm font-semibold tracking-wide text-[var(--accent)]">
            ABI Merchant
          </h1>
          {props.screen !== 'entry' && (
            <button
              type="button"
              onClick={props.onStartOver}
              className="rounded px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--text)] border border-transparent hover:border-[var(--border)]"
            >
              Start over
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-[var(--border)] overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => props.onModeChange('automatic')}
              className={[
                'px-3 py-1.5 font-medium',
                autoActive
                  ? 'bg-[var(--accent-dim)] text-[var(--text)]'
                  : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Auto
            </button>
            <button
              type="button"
              onClick={() => props.onModeChange('manual')}
              className={[
                'px-3 py-1.5 font-medium border-l border-[var(--border)]',
                props.mode === 'manual'
                  ? 'bg-[var(--accent-dim)] text-[var(--text)]'
                  : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Manual
            </button>
          </div>

          <button
            type="button"
            onClick={props.onOpenTrouble}
            className={[
              'rounded px-2.5 py-1.5 text-[11px] font-medium border',
              props.screen === 'troubleshooting'
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]/30'
                : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]',
            ].join(' ')}
          >
            Troubleshooting
          </button>

          {showListenToggle &&
            (!props.capturing ? (
              <button
                type="button"
                onClick={props.onStartListening}
                className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110"
              >
                Start
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onStopListening}
                className="rounded px-3 py-1.5 text-[11px] font-medium bg-[#3a1f24] text-[#ffb4bc] border border-[#5c2a33]"
              >
                Stop
              </button>
            ))}
        </div>
      </div>
    </header>
  );
}
