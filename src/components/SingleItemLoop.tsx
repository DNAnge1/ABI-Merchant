import { SizeGroupedResults } from './SizeGroupedResults';
import type { MatchResult, MerchantItem } from '../utils/audioMatcher';

export type SingleLoopPhase = 'ready' | 'locked';

export function SingleItemLoop(props: {
  phase: SingleLoopPhase;
  capturing: boolean;
  match: MatchResult | null;
  resultItems: MerchantItem[];
  altMatches?: MatchResult[];
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onSkip: () => void;
  onPickAlt?: (soundId: number) => void;
}) {
  if (props.phase === 'ready') {
    return (
      <div
        className={[
          'rounded border px-4 py-8 text-center',
          props.capturing
            ? 'border-[var(--accent)] bg-[var(--accent-dim)]/20 animate-pulse'
            : 'border-dashed border-[var(--border)] bg-[var(--bg-panel)]/50',
        ].join(' ')}
      >
        <p className="m-0 text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold">
          Style A · Single Item
        </p>
        <h2 className="m-0 mt-2 text-lg font-semibold text-[var(--text)]">
          {props.capturing
            ? 'Listening… waiting for merchant sounds'
            : 'Start Listening to enter Ready'}
        </h2>
        <p className="m-0 mt-2 text-xs text-[var(--muted)] max-w-md mx-auto">
          {props.capturing
            ? 'Stay here as long as you need — lobby / travel is fine. When you drag Mystery Cargo at the Field Merchant, we lock Group # and pause for 👍 / 👎 / ⏭️ (Space or Esc skips).'
            : 'Share game audio, then wait indefinitely until the first cargo spike. Silence is not a failure.'}
        </p>
      </div>
    );
  }

  if (!props.match) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-[var(--accent)] bg-[var(--bg-elevated)] px-3 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Locked · listening paused
          </p>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-bold text-[var(--accent)]">
              Group #{props.match.soundId}
            </span>
            <span className="text-sm text-[var(--text)] tabular-nums">
              {props.match.confidence}% confidence
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={props.onThumbsUp}
            className="rounded px-3 py-2 text-sm font-semibold bg-[var(--ok)]/20 border border-[var(--ok)] text-[var(--ok)]"
            title="Correct"
          >
            👍 Correct
          </button>
          <button
            type="button"
            onClick={props.onThumbsDown}
            className="rounded px-3 py-2 text-sm font-semibold bg-[var(--mythic)]/15 border border-[var(--mythic)] text-[var(--mythic-gold)]"
            title="Wrong — log miss"
          >
            👎 Wrong
          </button>
          <button
            type="button"
            onClick={props.onSkip}
            className="rounded px-3 py-2 text-sm border border-[var(--border)] text-[var(--muted)]"
            title="Skip (Space / Esc)"
          >
            ⏭️ Skip
          </button>
        </div>
      </div>

      <SizeGroupedResults
        soundId={props.match.soundId}
        items={props.resultItems}
        matchConfidence={props.match.confidence}
        matchKind={props.match.kind}
        altMatches={props.altMatches}
        onPickAlt={props.onPickAlt}
        modeLabel="Single-item lock"
      />
    </div>
  );
}
