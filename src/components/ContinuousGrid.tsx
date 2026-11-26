import { redLikelihoodPercent } from '../utils/sizeGroups';
import type { MerchantItem } from '../utils/audioMatcher';
import {
  ActiveSessionError,
  BurstCaptureControls,
  SessionErrorHistory,
  type SessionErrorEntry,
} from './SessionErrorHistory';
import type { RankedSoundCandidate } from '../utils/rankedGuess';
import { TacticalResultCard, TacticalSlotChip } from './TacticalResultCard';
import { filterScoredFeed } from '../utils/resultProbability';
import {
  computeEvSummary,
  scoreWithinRaidFilter,
  type MapModeOption,
  type RaidFilter,
} from '../utils/raidPools';

export interface SessionSlot {
  id: string;
  soundId: number;
  confidence: number;
  kind: string;
  redPct: number;
  /** Phase 2: weighted red over ranked pool when available. */
  redChancePercent?: number;
  items: MerchantItem[];
  ts: number;
  lowConfidence?: boolean;
  rankedCandidates?: RankedSoundCandidate[];
  isolatedItem?: boolean;
}

export function ContinuousGrid(props: {
  slots: SessionSlot[];
  onThumbsUp: (id: string) => void;
  onThumbsDown: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onNewMerchant: () => void;
  listening: boolean;
  /** Mid-screen Start Listening (same as header) when not capturing */
  onStartListening?: () => void;
  /** Last burst WAV — under Start Listening / listening box, above errors + Latest Lock */
  captureUrl?: string | null;
  captureDurationMs?: number;
  onPlayCapture?: () => void;
  onDownloadCapture?: () => void;
  sessionErrors?: SessionErrorEntry[];
  onClearSessionErrors?: () => void;
  /** Multi move counter — shown inside the Start Listening / listening area */
  multiArmed?: boolean;
  multiSpikeCount?: number;
  multiTargetN?: number;
  multiPhase?: string;
  mapModes?: MapModeOption[];
  raidFilter?: RaidFilter;
}) {
  const latest = props.slots[0] ?? null;
  const activeError = props.sessionErrors?.[0] ?? null;
  const targetN = props.multiTargetN ?? 3;
  const spikeN = props.multiSpikeCount ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Live session feed · Continuous Grid
          </h2>
          <p className="m-0 text-[11px] text-[var(--muted)]">
            {props.listening
              ? 'Multi / listening — move each cargo 3×; locks append here with item images'
              : 'Not listening'}{' '}
            · {props.slots.length} slot{props.slots.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={props.onClearAll}
            className="rounded px-2 py-1 text-[11px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            Clear All
          </button>
          <button
            type="button"
            onClick={props.onNewMerchant}
            className="rounded px-2 py-1 text-[11px] border border-[var(--accent)]/50 text-[var(--accent)]"
          >
            New Merchant Refresh
          </button>
        </div>
      </div>

      {/* Start Listening / listening circle — move counter lives here for Multi */}
      <div
        className={[
          'rounded-full sm:rounded-[2rem] border px-4 py-8 text-center mx-auto w-full max-w-xl',
          props.listening
            ? 'border-[var(--accent)] bg-[var(--accent-dim)]/20'
            : 'border-[var(--accent)] bg-[var(--accent-dim)]/20',
        ].join(' ')}
      >
        <p className="m-0 text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold">
          Style B · Multiple Items
        </p>
        {!props.listening ? (
          <>
            <h2 className="m-0 mt-2 text-lg font-semibold text-[var(--text)]">
              Start Listening to scan the merchant
            </h2>
            <p className="m-0 mt-2 text-xs text-[var(--muted)] max-w-md mx-auto">
              Dual monitor recommended. After Start Listening: At Shop → Arm Multi scan → drag each
              cargo 3 times. Locks show item images and value.
            </p>
            {props.onStartListening && (
              <button
                type="button"
                onClick={props.onStartListening}
                className="mt-4 rounded px-4 py-2 text-sm font-semibold bg-[var(--accent)] text-[#041412] hover:brightness-110"
              >
                Start Listening
              </button>
            )}
          </>
        ) : (
          <>
            <h2 className="m-0 mt-2 text-lg font-semibold text-[var(--text)]">
              {props.multiArmed ? 'Listening · Multi armed' : 'Listening · At Shop → Arm Multi'}
            </h2>
            {props.multiArmed ? (
              <div className="mt-4 inline-flex flex-col items-center gap-1">
                <span
                  className="rounded-full px-5 py-2 text-2xl font-bold tabular-nums border-2 border-[var(--accent)] bg-[var(--bg)] text-[var(--text)]"
                  title="Cargo moves this item — always waits for full count"
                >
                  {spikeN}/{targetN}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  moves
                  {props.multiPhase === 'cooldown'
                    ? ' · cooldown'
                    : props.multiPhase === 'matching'
                      ? ' · matching…'
                      : ''}
                </span>
              </div>
            ) : (
              <p className="m-0 mt-3 text-xs text-[var(--muted)] max-w-md mx-auto">
                At Shop → Arm Multi scan in Shop capture, then drag each cargo{' '}
                <strong className="text-[var(--text)]">{targetN} times</strong>. Move counter
                appears here.
              </p>
            )}
          </>
        )}

        {activeError && (
          <div className="mt-4 text-left max-w-lg mx-auto">
            <ActiveSessionError entry={activeError} label="Active detect error" />
          </div>
        )}
      </div>

      {/* Under listening area: playback → session history → Latest Lock */}
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

      {latest && (() => {
        const scored = scoreWithinRaidFilter(
          latest.items,
          props.raidFilter ?? {},
          props.mapModes ?? [],
        );
        const feed = filterScoredFeed(scored, {
          onlyRed: false,
          onlyYellow: false,
        });
        const ev = computeEvSummary(scored, props.raidFilter?.cargoPrice);
        return (
        <TacticalResultCard
          items={feed}
          redChancePercent={latest.redChancePercent ?? latest.redPct}
          soundId={latest.soundId}
          audioConfidence={latest.confidence}
          lowConfidence={latest.lowConfidence}
          isolatedItem={latest.isolatedItem}
          meta="Latest Multi lock"
          expectedValue={ev.expectedValue}
          paybackPercent={ev.paybackPercent}
        >
          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/8 pt-3">
            <button
              type="button"
              onClick={() => props.onThumbsUp(latest.id)}
              className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--ok)]/40 text-[var(--ok)]"
            >
              👍 Correct
            </button>
            <button
              type="button"
              onClick={() => props.onThumbsDown(latest.id)}
              className="rounded px-3 py-1.5 text-[11px] font-semibold border border-[var(--mythic)]/40 text-[var(--mythic-gold)]"
            >
              👎 Wrong
            </button>
            <button
              type="button"
              onClick={() => props.onDismiss(latest.id)}
              className="rounded px-3 py-1.5 text-[11px] border border-[var(--border)] text-[var(--muted)]"
            >
              Dismiss
            </button>
          </div>
        </TacticalResultCard>
        );
      })()}

      {props.slots.length > 1 ? (
        <div>
          <p className="m-0 mb-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Earlier locks
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {props.slots.slice(1).map((slot) => {
              const scored = filterScoredFeed(
                scoreWithinRaidFilter(
                  slot.items,
                  props.raidFilter ?? {},
                  props.mapModes ?? [],
                ),
                {
                  onlyRed: false,
                  onlyYellow: false,
                },
              );
              return (
                <div key={slot.id} className="space-y-1.5">
                  <TacticalSlotChip
                    soundId={slot.soundId}
                    confidence={slot.confidence}
                    items={scored}
                    redChancePercent={slot.redChancePercent ?? slot.redPct}
                    lowConfidence={slot.lowConfidence}
                    onDismiss={() => props.onDismiss(slot.id)}
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => props.onThumbsUp(slot.id)}
                      className="flex-1 rounded py-1 text-[11px] border border-[var(--ok)]/40 text-[var(--ok)]"
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onThumbsDown(slot.id)}
                      className="flex-1 rounded py-1 text-[11px] border border-[var(--mythic)]/40 text-[var(--mythic-gold)]"
                    >
                      👎
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function buildSlotFromMatch(
  match: { soundId: number; confidence: number; kind: string },
  allItems: MerchantItem[],
  opts?: {
    lowConfidence?: boolean;
    redChancePercent?: number;
    rankedCandidates?: RankedSoundCandidate[];
    isolatedItem?: boolean;
  },
): SessionSlot {
  const slotItems = allItems.filter((i) => i.soundId === match.soundId);
  return {
    id: `${Date.now()}-${match.soundId}-${Math.random().toString(36).slice(2, 6)}`,
    soundId: match.soundId,
    confidence: match.confidence,
    kind: match.kind,
    redPct: redLikelihoodPercent(slotItems),
    redChancePercent: opts?.redChancePercent,
    items: slotItems,
    ts: Date.now(),
    lowConfidence: opts?.lowConfidence,
    rankedCandidates: opts?.rankedCandidates,
    isolatedItem: opts?.isolatedItem,
  };
}
