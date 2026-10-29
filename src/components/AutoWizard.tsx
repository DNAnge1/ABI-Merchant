import type { MonitorSetup } from '../utils/calibrationStore';
import type { SensitivityLevel } from '../utils/sensitivity';
import { StepRow, type WizardStep } from './StepRow';
import { WipAccuracyBanner } from './WipAccuracyBanner';

export type AutoSettings = {
  soundAlerts: boolean;
  useTts: boolean;
  sensitivity: SensitivityLevel;
  hideImages: boolean;
  focusGuard: boolean;
};

type SettingDef = {
  id: keyof AutoSettings | 'scan-style' | 'second-screen';
  label: string;
  definition: string;
  recommended?: boolean;
  /** Settings that are informational / always-on for dual */
  alwaysOn?: boolean;
};

const SINGLE_SETTINGS: SettingDef[] = [
  {
    id: 'focusGuard',
    label: 'Ignore Alt+Tab focus noise',
    definition:
      'On one monitor, clicking this app steals focus from the game. When on, short focus-switch clicks are less likely to false-trigger a lock.',
    recommended: true,
  },
  {
    id: 'sensitivity',
    label: 'Match sensitivity (Med)',
    definition:
      'How closely a field click must match a known pickup before the group locks. Med is recommended for Field Merchant.',
    recommended: true,
  },
  {
    id: 'soundAlerts',
    label: 'Alert on lock',
    definition: 'Plays a short cue when a group locks so you can keep eyes on the game.',
    recommended: true,
  },
  {
    id: 'useTts',
    label: 'Speak group on lock',
    definition: 'Optional TTS of the locked group number after the alert cue.',
  },
  {
    id: 'hideImages',
    label: 'Hide cargo images',
    definition:
      'Images show by default in results. Turn this on only if you want a compact text-only feed.',
  },
];

const MULTI_SETTINGS: SettingDef[] = [
  {
    id: 'second-screen',
    label: 'App stays on second screen',
    definition:
      'Keep ABI on the main monitor and Merchant on a second display so the game keeps focus and capture stays clean.',
    recommended: true,
    alwaysOn: true,
  },
  {
    id: 'scan-style',
    label: 'Continuous Multi scan',
    definition:
      'Keeps listening across moves. Multi always waits for 3 moves before locking — not a one-shot burst.',
    recommended: true,
    alwaysOn: true,
  },
  {
    id: 'sensitivity',
    label: 'Match sensitivity (Med)',
    definition:
      'How closely a field click must match a known pickup before the group locks. Med is recommended for Field Merchant.',
    recommended: true,
  },
  {
    id: 'soundAlerts',
    label: 'Alert on lock',
    definition: 'Plays a short cue when a group locks so you can keep eyes on the game.',
    recommended: true,
  },
  {
    id: 'useTts',
    label: 'Speak group on lock',
    definition: 'Optional TTS of the locked group number after the alert cue.',
  },
  {
    id: 'hideImages',
    label: 'Hide cargo images',
    definition:
      'Images show by default in results. Turn this on only if you want a compact text-only feed.',
  },
];

export function AutoWizard(props: {
  step: WizardStep;
  monitorSetup: MonitorSetup | null;
  settings: AutoSettings;
  onSelectMonitors: (m: MonitorSetup) => void;
  onJump: (step: WizardStep) => void;
  onBack: () => void;
  onChangeSettings: (patch: Partial<AutoSettings>) => void;
  onNext: () => void;
}) {
  const isMulti = props.monitorSetup === 'dual';
  const list = isMulti ? MULTI_SETTINGS : SINGLE_SETTINGS;
  const backLabel =
    props.step === 'settings' ? '← Monitors' : '← Start over';

  return (
    <div className="max-w-[760px] mx-auto flex flex-col gap-5">
      <div className="space-y-1.5">
        <h2 className="m-0 text-2xl font-medium tracking-tight">Automatic setup</h2>
        <p className="m-0 text-sm text-[var(--muted)] leading-relaxed">
          Only settings that apply to your layout. Recommended options are marked.
        </p>
      </div>

      <WipAccuracyBanner />

      <StepRow
        step={props.step}
        onJump={props.onJump}
        onBack={props.onBack}
        backLabel={backLabel}
      />

      {props.step === 'monitors' && (
        <div className="flex flex-col gap-3.5">
          <h3 className="m-0 text-lg font-medium">Single or multiple monitors?</h3>
          <p className="m-0 text-sm text-[var(--muted)] leading-relaxed">
            Why it matters: one screen means Alt+Tab focus noise when you click Merchant. A second
            screen lets the game keep focus while the app stays visible.
          </p>
          <ChoiceBlock
            title="Single monitor"
            body="Game and Merchant share one screen. Expect focus switches; we dampen Alt+Tab noise. Single-item scan."
            active={props.monitorSetup === 'single'}
            onClick={() => props.onSelectMonitors('single')}
          />
          <ChoiceBlock
            title="Multiple monitors (Dual)"
            body="Game on main, Merchant on second. Cleaner capture; Continuous Multi scan (always 3 moves)."
            active={props.monitorSetup === 'dual'}
            onClick={() => props.onSelectMonitors('dual')}
          />
        </div>
      )}

      {props.step === 'settings' && props.monitorSetup && (
        <div className="flex flex-col gap-3.5">
          <h3 className="m-0 text-lg font-medium">
            {isMulti ? 'Multi-monitor settings' : 'Single-monitor settings'}
          </h3>
          <div className="flex flex-col gap-2.5">
            {list.map((s) => {
              const checked = settingChecked(s.id, props.settings, isMulti);
              return (
                <SettingRow
                  key={s.id}
                  setting={s}
                  checked={checked}
                  disabled={s.alwaysOn}
                  onChange={() => toggleSetting(s, props.settings, props.onChangeSettings)}
                />
              );
            })}
          </div>
          <div>
            <button
              type="button"
              onClick={props.onNext}
              className="rounded-lg px-4 py-2 text-sm font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function settingChecked(
  id: SettingDef['id'],
  settings: AutoSettings,
  isMulti: boolean,
): boolean {
  if (id === 'second-screen' || id === 'scan-style') return isMulti;
  if (id === 'sensitivity') return settings.sensitivity === 'med';
  return Boolean(settings[id as keyof AutoSettings]);
}

function toggleSetting(
  s: SettingDef,
  settings: AutoSettings,
  onChange: (patch: Partial<AutoSettings>) => void,
) {
  if (s.alwaysOn) return;
  if (s.id === 'sensitivity') {
    onChange({ sensitivity: settings.sensitivity === 'med' ? 'high' : 'med' });
    return;
  }
  if (s.id === 'soundAlerts') {
    onChange({ soundAlerts: !settings.soundAlerts });
    return;
  }
  if (s.id === 'useTts') {
    onChange({ useTts: !settings.useTts });
    return;
  }
  if (s.id === 'hideImages') {
    onChange({ hideImages: !settings.hideImages });
    return;
  }
  if (s.id === 'focusGuard') {
    onChange({ focusGuard: !settings.focusGuard });
  }
}

function ChoiceBlock(props: {
  title: string;
  body: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'w-full text-left rounded-xl px-4 py-3.5 border',
        props.active
          ? 'border-[var(--accent)] bg-[var(--accent-dim)]/30'
          : 'border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--accent)]/50',
      ].join(' ')}
    >
      <div className="font-semibold text-[15px] text-[var(--text)]">{props.title}</div>
      <div className="mt-1 text-[13px] text-[var(--muted)] leading-relaxed">{props.body}</div>
    </button>
  );
}

function SettingRow(props: {
  setting: SettingDef;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3.5">
      <div className="flex gap-3 items-start justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">{props.setting.label}</span>
            {props.setting.recommended && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#041412] bg-[var(--accent)] px-1.5 py-0.5 rounded">
                Recommended
              </span>
            )}
          </div>
          <p className="m-0 text-[13px] text-[var(--muted)] leading-snug">
            {props.setting.definition}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={props.checked}
          disabled={props.disabled}
          onClick={props.onChange}
          className={[
            'w-10 h-[22px] rounded-full p-0.5 shrink-0 border-0',
            props.checked ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
            props.disabled ? 'opacity-70 cursor-default' : 'cursor-pointer',
          ].join(' ')}
        >
          <span
            className={[
              'block w-[18px] h-[18px] rounded-full transition-transform',
              props.checked
                ? 'translate-x-[18px] bg-[#041412]'
                : 'translate-x-0 bg-[var(--muted)]',
            ].join(' ')}
          />
        </button>
      </div>
    </div>
  );
}
