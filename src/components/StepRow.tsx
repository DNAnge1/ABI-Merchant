export type WizardStep = 'monitors' | 'settings' | 'listen';

export function StepRow(props: {
  step: WizardStep;
  onJump: (step: WizardStep) => void;
  onBack: () => void;
  backLabel: string;
}) {
  const steps: { id: WizardStep; label: string }[] = [
    { id: 'monitors', label: 'Monitors' },
    { id: 'settings', label: 'Settings' },
    { id: 'listen', label: 'Listen' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill active={false} onClick={props.onBack} label={props.backLabel} />
      <span className="text-[var(--border)] mx-0.5">|</span>
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          {i > 0 && <span className="text-[var(--muted)] text-xs">→</span>}
          <Pill
            active={props.step === s.id}
            onClick={() => props.onJump(s.id)}
            label={`${i + 1} · ${s.label}`}
          />
        </div>
      ))}
    </div>
  );
}

function Pill(props: { label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'rounded-full px-3 py-1 text-[12px] font-medium border whitespace-nowrap',
        props.active
          ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--text)]'
          : 'border-[var(--border)] bg-[var(--bg-panel)] text-[var(--muted)] hover:text-[var(--text)]',
      ].join(' ')}
    >
      {props.label}
    </button>
  );
}
