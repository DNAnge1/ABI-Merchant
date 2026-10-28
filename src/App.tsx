import { useEffect, useMemo, useRef, useState } from 'react';
import merchantData from './data/merchantData.json';
import fingerprintsData from './data/fingerprints.json';
import { StatusBar } from './components/StatusBar';
import { FilterPanel } from './components/FilterPanel';
import { MerchantGrid } from './components/MerchantGrid';
import { SoundBoard, type SoundProfile } from './components/SoundBoard';
import { MatchPanel, redLikelihoodPercent } from './components/MatchPanel';
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

function candidatesForSound(
  soundId: number,
  filtered: MerchantItem[],
  size: string,
): MerchantItem[] {
  const fromFilters = filtered.filter((i) => i.soundId === soundId);
  if (fromFilters.length) return fromFilters;
  return items.filter((i) => i.soundId === soundId && (!size || i.size === size));
}

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

  const activeSoundId = manualSoundId ?? matches[0]?.soundId ?? null;
  const activeMatch = matches.find((m) => m.soundId === activeSoundId) ?? matches[0] ?? null;

  const matchCandidates = useMemo(() => {
    if (activeSoundId == null) return [];
    return candidatesForSound(activeSoundId, filtered, size);
  }, [activeSoundId, filtered, size]);

  const redPct = useMemo(
    () => (activeSoundId == null ? null : redLikelihoodPercent(matchCandidates)),
    [activeSoundId, matchCandidates],
  );

  const confidences = useMemo(() => {
    const map: Record<number, number> = {};
    for (const m of matches) map[m.soundId] = m.confidence;
    return map;
  }, [matches]);

  const displayItems = useMemo(() => {
    if (activeSoundId != null) {
      return [...matchCandidates].sort(
        (a, b) => b.rarity - a.rarity || b.contactPrice - a.contactPrice,
      );
    }
    return [...filtered].sort((a, b) => b.rarity - a.rarity || b.contactPrice - a.contactPrice);
  }, [filtered, activeSoundId, matchCandidates]);

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

  function clearResult() {
    setManualSoundId(null);
    setMatches([]);
    setStatus(capturing ? 'listening' : 'idle');
    setStatusDetail(capturing ? 'Listening… grab or drag the cargo in-game' : undefined);
  }

  const topRedName = matchCandidates.find((i) => i.rarity >= 6)?.name;
  const statusDoneDetail =
    activeSoundId != null && redPct != null
      ? `Done: Sound ${activeSoundId} · RED ${redPct}%` +
        (topRedName ? ` · e.g. ${topRedName}` : '') +
        (activeMatch ? ` · audio ${activeMatch.confidence}%` : '')
      : statusDetail;

  return (
    <div className="min-h-full flex flex-col">
      <StatusBar
        status={activeSoundId != null ? 'done' : status}
        hasCargo={hasCargo}
        detail={activeSoundId != null ? statusDoneDetail : statusDetail}
        capturing={capturing}
        redPct={redPct}
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
            }}
          />

          <SoundBoard
            sounds={sounds}
            items={filtered}
            activeSoundId={activeSoundId}
            onPickSound={(id) => {
              setManualSoundId(id);
              setMatches([]);
              setStatus('done');
              setStatusDetail(`Manual: Sound ${id}`);
            }}
          />

          <p className="m-0 text-[10px] leading-relaxed text-[var(--muted)] px-1">
            Open this site in Chrome/Edge on a second monitor. Click{' '}
            <strong className="text-[var(--text)]">Start Listening</strong>, share the game
            window <em>with audio</em>, then grab/drag Mystery Cargo. Matching stays 100% on-device
            ({merchantData.items.length} items · {merchantData.soundIds.length} sounds).
          </p>
        </aside>

        <section className="min-w-0 flex flex-col gap-3">
          {activeSoundId != null && (
            <MatchPanel
              soundId={activeSoundId}
              matchConfidence={activeMatch?.confidence}
              matchKind={activeMatch?.kind}
              candidates={matchCandidates}
              altMatches={matches}
              onPickAlt={(id) => setManualSoundId(id)}
              onClear={clearResult}
            />
          )}

          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                {activeSoundId != null ? 'Candidate grid' : 'Pool for filters'}
              </h2>
              <p className="m-0 text-[11px] text-[var(--muted)]">
                {activeSoundId != null
                  ? `Sound ${activeSoundId} · ${matchCandidates.length} items · Reds first · Koen values`
                  : `${candidateSoundIds.length} sounds · ${filtered.length} items — listen or pick a sound`}
              </p>
            </div>
          </div>

          <MerchantGrid
            items={displayItems}
            highlightedSoundId={activeSoundId}
            confidences={confidences}
            showKoen
          />
        </section>
      </main>
    </div>
  );
}
