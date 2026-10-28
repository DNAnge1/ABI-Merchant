import type { MonitorSetup, ScanStyle } from '../utils/calibrationStore';

export function SetupSelector(props: {
  monitorSetup: MonitorSetup;
  scanStyle: ScanStyle;
  soundAlerts: boolean;
  useTts: boolean;
  onMonitorSetup: (v: MonitorSetup) => void;
  onScanStyle: (v: ScanStyle) => void;
  onSoundAlerts: (v: boolean) => void;
  onUseTts: (v: boolean) => void;
  onPopOut: () => void;
}) {
  const singleMonitor = props.monitorSetup === 'single';
  const multiDisabled = singleMonitor;

  return (
    <section className="rounded border border-[var(--border)] bg-[var(--bg-panel)] p-3">
      <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        Top setup
      </h2>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="m-0 mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Monitor setup
          </p>
          <div className="flex rounded border border-[var(--border)] overflow-hidden text-[11px]">
            <Toggle
              active={props.monitorSetup === 'single'}
              onClick={() => props.onMonitorSetup('single')}
              label="Single"
            />
            <Toggle
              active={props.monitorSetup === 'dual'}
              onClick={() => props.onMonitorSetup('dual')}
              label="Dual"
              border
            />
          </div>
        </div>

        <div>
          <p className="m-0 mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
            Scan style
          </p>
          <div className="flex rounded border border-[var(--border)] overflow-hidden text-[11px]">
            <Toggle
              active={props.scanStyle === 'single'}
              onClick={() => props.onScanStyle('single')}
              label="Single Item"
            />
            <button
              type="button"
              disabled={multiDisabled}
              title={
                multiDisabled
                  ? 'Multiple Items needs Dual monitor — Alt+Tab on one screen hurts accuracy'
                  : undefined
              }
              onClick={() => !multiDisabled && props.onScanStyle('continuous')}
              className={[
                'flex-1 px-2 py-1.5 font-medium border-l border-[var(--border)]',
                multiDisabled
                  ? 'opacity-40 cursor-not-allowed text-[var(--muted)]'
                  : props.scanStyle === 'continuous'
                    ? 'bg-[var(--accent-dim)] text-[var(--text)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Multiple Items
            </button>
          </div>
          {singleMonitor && (
            <p className="m-0 mt-1.5 text-[10px] leading-relaxed text-[var(--warn)]">
              Single monitor locks Continuous Grid. Alt+Tab back into the game adds a 1.5s grace so
              focus noise doesn’t false-scan. Use Dual for Multiple Items.
            </p>
          )}
        </div>
      </div>

      {singleMonitor && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
          <label className="inline-flex items-center gap-1.5 text-[var(--text)]">
            <input
              type="checkbox"
              checked={props.soundAlerts}
              onChange={(e) => props.onSoundAlerts(e.target.checked)}
            />
            Sound Alerts
          </label>
          <label
            className={[
              'inline-flex items-center gap-1.5',
              props.soundAlerts ? 'text-[var(--text)]' : 'text-[var(--muted)]',
            ].join(' ')}
          >
            <input
              type="checkbox"
              disabled={!props.soundAlerts}
              checked={props.useTts}
              onChange={(e) => props.onUseTts(e.target.checked)}
            />
            TTS “Group X, Red Possible”
          </label>
          <button
            type="button"
            onClick={props.onPopOut}
            className="rounded px-2 py-1 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)]"
          >
            Pop Out Mini-Overlay
          </button>
        </div>
      )}
    </section>
  );
}

function Toggle(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  border?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'flex-1 px-2 py-1.5 font-medium',
        props.border ? 'border-l border-[var(--border)]' : '',
        props.active
          ? 'bg-[var(--accent-dim)] text-[var(--text)]'
          : 'text-[var(--muted)] hover:text-[var(--text)]',
      ].join(' ')}
    >
      {props.label}
    </button>
  );
}
