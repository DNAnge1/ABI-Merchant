import { useEffect, useMemo, useRef, useState } from 'react';
import merchantData from './data/merchantData.json';
import fingerprintsData from './data/fingerprints.json';
import { StatusBar } from './components/StatusBar';
import { FilterPanel } from './components/FilterPanel';
import { MerchantGrid } from './components/MerchantGrid';
import { SoundBoard, type SoundProfile } from './components/SoundBoard';
import {
  AudioMatcher,
  filterItemsByCargo,
  type FingerprintsFile,
  type MatcherStatus,
  type MatchResult,
  type MerchantItem,
} from './utils/audioMatcher';

const items = merchantData.items as MerchantItem[];
const fingerprints = fingerprintsData as FingerprintsFile;
const sounds = merchantData.soundIds as SoundProfile[];

export default function App() {
  const [size, setSize] = useState('2x2');
  const [cargoType, setCargoType] = useState('Mystery Cargo');
  const [cargoPrice, setCargoPrice] = useState<number | ''>(70000);
  const [noiseFloor, setNoiseFloor] = useState(0.18);
  const [status, setStatus] = useState<MatcherStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string>();
  const [capturing, setCapturing] = useState(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [manualSoundId, setManualSoundId] = useState<number | null>(null);
  const matcherRef = useRef<AudioMatcher | null>(null);

  const filtered = useMemo(
    () =>
      filterItemsByCargo(items, {
        size: size || undefined,
        cargoType: cargoType || undefined,
        cargoPrice: cargoPrice === '' ? undefined : cargoPrice,
      }),
    [size, cargoType, cargoPrice],
  );

  const candidateSoundIds = useMemo(
    () => Array.from(new Set(filtered.map((i) => i.soundId))).sort((a, b) => a - b),
    [filtered],
  );

  const highlightedSoundId =
    manualSoundId ?? matches[0]?.soundId ?? null;

  const confidences = useMemo(() => {
    const map: Record<number, number> = {};
    for (const m of matches) map[m.soundId] = m.confidence;
    return map;
  }, [matches]);

  const displayItems = useMemo(() => {
    let list = filtered;
    if (highlightedSoundId != null) {
      list = list.filter((i) => i.soundId === highlightedSoundId);
      if (!list.length) {
        // Manual sound pick outside filter — show all items with that sound under size filter only
        list = items.filter(
          (i) =>
            i.soundId === highlightedSoundId &&
            (!size || i.size === size),
        );
      }
    }
    // Mythics first within the list
    return [...list].sort((a, b) => {
      if (highlightedSoundId != null) {
        const ca = confidences[a.soundId] ?? 0;
        const cb = confidences[b.soundId] ?? 0;
        if (cb !== ca) return cb - ca;
      }
      return b.rarity - a.rarity || b.contactPrice - a.contactPrice;
    });
  }, [filtered, highlightedSoundId, confidences, size]);

  useEffect(() => {
    const matcher = new AudioMatcher(fingerprints, { noiseFloor });
    matcher.setCallbacks({
      onStatus: (s, detail) => {
        setStatus(s);
        setStatusDetail(detail);
      },
      onMatch: (m) => {
        setManualSoundId(null);
        setMatches(m);
      },
    });
    matcherRef.current = matcher;
    return () => {
      void matcher.stop();
      matcherRef.current = null;
    };
  }, []);

  useEffect(() => {
    matcherRef.current?.setCandidates(candidateSoundIds);
  }, [candidateSoundIds]);

  useEffect(() => {
    matcherRef.current?.setNoiseFloor(noiseFloor);
  }, [noiseFloor]);

  const hasCargo = Boolean(size || cargoPrice !== '' || cargoType);

  async function startCapture() {
    try {
      setMatches([]);
      setManualSoundId(null);
      await matcherRef.current?.startCapture();
      setCapturing(true);
    } catch (err) {
      setCapturing(false);
      setStatus('error');
      setStatusDetail(err instanceof Error ? err.message : String(err));
    }
  }

  async function stopCapture() {
    await matcherRef.current?.stop();
    setCapturing(false);
  }

  const topMatch = matches[0];
  const topItems = topMatch
    ? items.filter((i) => i.soundId === topMatch.soundId && filtered.some((f) => f.id === i.id))
    : [];
  const topName = topItems[0]?.name || (topMatch ? `Sound ${topMatch.soundId}` : null);

  return (
    <div className="min-h-full flex flex-col">
      <StatusBar
        status={status}
        hasCargo={hasCargo}
        detail={
          status === 'done' && topName && topMatch
            ? `Done: ${topName} ${topMatch.confidence}%`
            : statusDetail
        }
        capturing={capturing}
        onStart={() => void startCapture()}
        onStop={() => void stopCapture()}
      />

      <main className="flex-1 p-3 grid gap-3 lg:grid-cols-[320px_1fr]">
        <aside className="flex flex-col gap-3 min-w-0">
          <FilterPanel
            sizes={merchantData.sizes}
            cargoTypes={merchantData.cargoTypes}
            cargoPrices={merchantData.cargoPrices}
            size={size}
            cargoType={cargoType}
            cargoPrice={cargoPrice}
            noiseFloor={noiseFloor}
            onChange={(patch) => {
              if (patch.size !== undefined) setSize(patch.size);
              if (patch.cargoType !== undefined) setCargoType(patch.cargoType);
              if (patch.cargoPrice !== undefined) setCargoPrice(patch.cargoPrice);
              if (patch.noiseFloor !== undefined) setNoiseFloor(patch.noiseFloor);
              setManualSoundId(null);
              setMatches([]);
            }}
          />

          <SoundBoard
            sounds={sounds}
            items={filtered}
            activeSoundId={highlightedSoundId}
            onPickSound={(id) => {
              setManualSoundId(id);
              setMatches([]);
              setStatus('done');
              setStatusDetail(`Manual: Sound ${id}`);
            }}
          />

          <p className="m-0 text-[10px] leading-relaxed text-[var(--muted)] px-1">
            100% client-side. Capture uses{' '}
            <code className="text-[var(--accent)]">getDisplayMedia</code> — audio never leaves
            this device. Data from abibuilder.com/merchant (
            {merchantData.items.length} items · {merchantData.soundIds.length} sounds).
          </p>
        </aside>

        <section className="min-w-0 flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Candidates
              </h2>
              <p className="m-0 text-[11px] text-[var(--muted)]">
                {candidateSoundIds.length} sounds · {filtered.length} items
                {highlightedSoundId != null ? ` · showing sound ${highlightedSoundId}` : ''}
              </p>
            </div>
            {highlightedSoundId != null && (
              <button
                type="button"
                className="text-[11px] text-[var(--accent)] hover:underline"
                onClick={() => {
                  setManualSoundId(null);
                  setMatches([]);
                  setStatus(capturing ? 'listening' : 'idle');
                  setStatusDetail(capturing ? 'Listening…' : undefined);
                }}
              >
                Clear match filter
              </button>
            )}
          </div>

          {matches.length > 0 && (
            <div className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 flex flex-wrap gap-2 items-center">
              <span className="text-[11px] text-[var(--muted)]">Top matches:</span>
              {matches.slice(0, 5).map((m) => {
                const mythic = items.some((i) => i.soundId === m.soundId && i.rarity >= 6);
                return (
                  <button
                    key={`${m.soundId}-${m.kind}`}
                    type="button"
                    onClick={() => setManualSoundId(m.soundId)}
                    className={[
                      'rounded px-2 py-1 text-[11px] border',
                      mythic
                        ? 'border-[var(--mythic)] text-[var(--mythic-gold)]'
                        : 'border-[var(--border)] text-[var(--text)]',
                    ].join(' ')}
                  >
                    #{m.soundId} {m.confidence}% ({m.kind})
                  </button>
                );
              })}
            </div>
          )}

          <MerchantGrid
            items={displayItems}
            highlightedSoundId={highlightedSoundId}
            confidences={confidences}
          />
        </section>
      </main>
    </div>
  );
}
