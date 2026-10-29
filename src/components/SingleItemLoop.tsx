import { SizeGroupedResults } from './SizeGroupedResults';
import type { MatchResult, MerchantItem } from '../utils/audioMatcher';
import {
  ActiveSessionError,
  BurstCaptureControls,
  SessionErrorHistory,
  type SessionErrorEntry,
} from './SessionErrorHistory';

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
  /** Mid-screen Start Listening (same as header) when not capturing */
  onStartListening?: () => void;
  captureUrl?: string | null;
  captureDurationMs?: number;
  onPlayCapture?: () => void;
  onDownloadCapture?: () => void;
  sessionErrors?: SessionErrorEntry[];
  onClearSessionErrors?: () => void;
}) {
  const activeError = props.sessionErrors?.[0] ?? null;
  const captureAndErrors = (
    <>
      <BurstCaptureControls
        captureUrl={props.captureUrl}
        captureDurationMs={props.captureDurationMs}
        onPlayCapture={props.onPlayCapture}
        onDownloadCapture={props.onDownloadCapture}
      />
      <SessionErrorHistory
        entries={props.sessionErrors ?? []}
        onClear={props.onClearSessionErrors}
        hideActiveBanner
      />
    </>
  );

  if (props.phase === 'ready') {
    return (
      <div className="flex flex-col gap-3">
        <div
          className={[
            'rounded-full sm:rounded-[2rem] border px-4 py-8 text-center mx-auto w-full max-w-xl',
            props.capturing
              ? 'border-[var(--accent)] bg-[var(--accent-dim)]/20 animate-pulse'
              : 'border-[var(--accent)] bg-[var(--accent-dim)]/20',
          ].join(' ')}
        >
          <p className="m-0 text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold">
            Style A · Single Item
          </p>
          <h2 className="m-0 mt-2 text-lg font-semibold text-[var(--text)]">
            {props.capturing
              ? 'In Raid until At Shop — then Move Item'
              : 'Start Listening to enter Ready'}
          </h2>
          <p className="m-0 mt-2 text-xs text-[var(--muted)] max-w-md mx-auto">
            {props.capturing
              ? 'Raid noise is gated off. At the Field Merchant click At Shop, Start Moving Item, drag cargo a few times, then Stop & Match.'
              : 'Share game audio anytime. Silence / travel is fine — click At Shop only when you reach the merchant.'}
          </p>
          {!props.capturing && props.onStartListening && (
            <button
              type="button"
              onClick={props.onStartListening}
              className="mt-4 rounded px-4 py-2 text-sm font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110"
            >
              Start Listening
            </button>
          )}
          {activeError && (
            <div className="mt-4 text-left max-w-lg mx-auto">
              <ActiveSessionError entry={activeError} label="Active detect error" />
            </div>
          )}
        </div>
        {/* Under Start Listening box: playback → session errors */}
        {captureAndErrors}
      </div>
    );
  }

  if (!props.match) return null;

  return (
    <div className="flex flex-col gap-3">
      {activeError && <ActiveSessionError entry={activeError} label="Active detect error" />}
      {captureAndErrors}
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
