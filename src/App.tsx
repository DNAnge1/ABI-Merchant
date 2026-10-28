import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import merchantData from './data/merchantData.json';
import fingerprintsData from './data/fingerprints.json';
import { StatusBar, type AppMode } from './components/StatusBar';
import { AudioVerifyPanel, playTestTone } from './components/AudioVerifyPanel';
import { ManualFilters } from './components/ManualFilters';
import { SoundBoard, type SoundProfile } from './components/SoundBoard';
import { SizeGroupedResults } from './components/SizeGroupedResults';
import {
  AudioMatcher,
  filterItemsByCargo,
  type FingerprintsFile,
  type MatcherStatus,
  type MatchResult,
  type MerchantItem,
} from './utils/audioMatcher';
import {
  detectBrowser,
  rmsFromAnalyser,
  supportsGetDisplayMedia,
  type VerifyState,
} from './utils/browserAudio';
import { redLikelihoodPercent } from './utils/sizeGroups';

const items = merchantData.items as MerchantItem[];
const fingerprints = fingerprintsData as FingerprintsFile;
const sounds = merchantData.soundIds as SoundProfile[];
const ALL_SOUND_IDS = sounds.map((s) => s.soundId).sort((a, b) => a - b);

const IDLE_VERIFY: VerifyState = {
  phase: 'idle',
  message: '',
  rms: 0,
  peakRms: 0,
  hasAudioTrack: false,
};

export default function App() {
  const [mode, setMode] = useState<AppMode>('automatic');
  const [size, setSize] = useState('');
  const [cargoType, setCargoType] = useState('');
  const [cargoPrice, setCargoPrice] = useState<number | ''>('');
  const [noiseFloor, setNoiseFloor] = useState(0.18);
  const [status, setStatus] = useState<MatcherStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string>();
  const [capturing, setCapturing] = useState(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [manualSoundId, setManualSoundId] = useState<number | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>(IDLE_VERIFY);

  const matcherRef = useRef<AudioMatcher | null>(null);
  const verifyCleanupRef = useRef<(() => void) | null>(null);

  const filteredManual = useMemo(
    () =>
      filterItemsByCargo(items, {
        size: size || undefined,
        cargoType: cargoType || undefined,
        cargoPrice: cargoPrice === '' ? undefined : cargoPrice,
      }),
    [size, cargoType, cargoPrice],
  );

  const activeSoundId = manualSoundId ?? matches[0]?.soundId ?? null;
  const activeMatch = matches.find((m) => m.soundId === activeSoundId) ?? matches[0] ?? null;

  const resultItems = useMemo(() => {
    if (activeSoundId == null) return [];
    const forSound = items.filter((i) => i.soundId === activeSoundId);
    if (mode === 'manual' && (size || cargoType || cargoPrice !== '')) {
      return forSound.filter((i) => {
        if (size && i.size !== size) return false;
        if (cargoType || cargoPrice !== '') {
          return i.sources.some((s) => {
            if (cargoType && s.cargoType !== cargoType) return false;
            if (cargoPrice !== '' && s.cargoPrice !== cargoPrice) return false;
            return true;
          });
        }
        return true;
      });
    }
    return forSound;
  }, [activeSoundId, mode, size, cargoType, cargoPrice]);

  const redPct = useMemo(
    () => (activeSoundId == null ? null : redLikelihoodPercent(resultItems)),
    [activeSoundId, resultItems],
  );

  const stopVerifySession = useCallback(() => {
    verifyCleanupRef.current?.();
    verifyCleanupRef.current = null;
  }, []);

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
    matcher.setCandidates(ALL_SOUND_IDS);
    matcherRef.current = matcher;
    return () => {
      stopVerifySession();
      void matcher.stop();
      matcherRef.current = null;
    };
  }, [stopVerifySession]);

  useEffect(() => {
    // Automatic: always all 38. Manual listening still matches all 38; filters only affect display pool / sound board highlight.
    matcherRef.current?.setCandidates(ALL_SOUND_IDS);
  }, [mode]);

  useEffect(() => {
    matcherRef.current?.setNoiseFloor(noiseFloor);
  }, [noiseFloor]);

  async function runVerify() {
    stopVerifySession();
    setVerifyOpen(true);

    const browser = detectBrowser();
    if (!supportsGetDisplayMedia() || !browser.autoCaptureSupported) {
      setVerifyState({
        phase: 'unsupported',
        message: `${browser.label} cannot reliably capture game audio for Automatic Mode.`,
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
      });
      return;
    }

    setVerifyState({
      phase: 'prompting',
      message: 'Share the game window / Entire Screen — enable audio when prompted…',
      rms: 0,
      peakRms: 0,
      hasAudioTrack: false,
    });

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } catch (err) {
      setVerifyState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Share cancelled or failed',
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
      });
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      setVerifyState({
        phase: 'no-audio',
        message: 'No Audio Track Detected',
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
      });
      return;
    }

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    let peak = 0;
    let raf = 0;
    const started = performance.now();
    const METER_MS = 3000;

    const tick = () => {
      const rms = rmsFromAnalyser(analyser);
      peak = Math.max(peak, rms);
      const elapsed = performance.now() - started;
      setVerifyState({
        phase: elapsed < METER_MS ? 'metering' : 'ok',
        message:
          elapsed < METER_MS
            ? 'Sampling input… move over ABI items or drag cargo'
            : 'Audio track OK',
        rms,
        peakRms: peak,
        hasAudioTrack: true,
      });
      if (elapsed < METER_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        // Keep a light meter while panel stays open
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    const cleanup = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    };
    verifyCleanupRef.current = cleanup;
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', cleanup));
  }

  async function startCapture() {
    const browser = detectBrowser();
    if (!browser.autoCaptureSupported) {
      setVerifyOpen(true);
      setVerifyState({
        phase: 'unsupported',
        message: `${browser.label} is not supported for Automatic capture.`,
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
      });
      return;
    }
    stopVerifySession();
    setVerifyOpen(false);
    try {
      setMatches([]);
      setManualSoundId(null);
      await matcherRef.current?.startCapture();
      setCapturing(true);
    } catch (err) {
      setCapturing(false);
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setStatusDetail(msg);
      setVerifyOpen(true);
      if (/no audio track/i.test(msg)) {
        setVerifyState({
          phase: 'no-audio',
          message: 'No Audio Track Detected',
          rms: 0,
          peakRms: 0,
          hasAudioTrack: false,
        });
      } else if (/not supported/i.test(msg)) {
        setVerifyState({
          phase: 'unsupported',
          message: msg,
          rms: 0,
          peakRms: 0,
          hasAudioTrack: false,
        });
      } else {
        setVerifyState({
          phase: 'error',
          message: msg,
          rms: 0,
          peakRms: 0,
          hasAudioTrack: false,
        });
      }
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
    setStatusDetail(
      capturing ? 'Listening… grab or drag Mystery Cargo (all 38 Sound IDs)' : undefined,
    );
  }

  function switchToManual() {
    stopVerifySession();
    setMode('manual');
    setVerifyOpen(false);
    setVerifyState(IDLE_VERIFY);
    void stopCapture();
  }

  const hasResult = activeSoundId != null;
  const statusDoneDetail =
    hasResult && redPct != null
      ? `Done: Sound ${activeSoundId} · RED ${redPct}%` +
        (activeMatch ? ` · audio ${activeMatch.confidence}%` : '') +
        (mode === 'automatic' ? ' · size-grouped' : '')
      : statusDetail;

  return (
    <div className="min-h-full flex flex-col">
      <StatusBar
        status={hasResult ? 'done' : status}
        mode={mode}
        detail={hasResult ? statusDoneDetail : statusDetail}
        capturing={capturing}
        hasResult={hasResult}
        redPct={redPct}
        onModeChange={(m) => {
          setMode(m);
          if (m === 'automatic') {
            setSize('');
            setCargoType('');
            setCargoPrice('');
          }
        }}
        onStart={() => void startCapture()}
        onStop={() => void stopCapture()}
        onVerify={() => void runVerify()}
      />

      <AudioVerifyPanel
        open={verifyOpen}
        state={verifyState}
        onClose={() => {
          stopVerifySession();
          setVerifyOpen(false);
        }}
        onRetry={() => void runVerify()}
        onSwitchManual={switchToManual}
        onPlayTone={() => void playTestTone()}
      />

      <main
        className={[
          'flex-1 p-3 grid gap-3',
          mode === 'manual' ? 'lg:grid-cols-[320px_1fr]' : 'lg:grid-cols-1',
        ].join(' ')}
      >
        {mode === 'manual' && (
          <aside className="flex flex-col gap-3 min-w-0">
            <ManualFilters
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
              items={filteredManual}
              activeSoundId={activeSoundId}
              onPickSound={(id) => {
                setManualSoundId(id);
                setMatches([]);
                setStatus('done');
                setStatusDetail(`Manual Sound ${id}`);
              }}
            />
            <p className="m-0 text-[10px] leading-relaxed text-[var(--muted)] px-1">
              Manual Mode: audition Pick up / Drop for all 38 IDs, click an ID to load size-grouped
              candidates. Filters are optional pills.
            </p>
          </aside>
        )}

        <section className="min-w-0 flex flex-col gap-3">
          {mode === 'automatic' && !hasResult && (
            <div className="rounded border border-dashed border-[var(--border)] bg-[var(--bg-panel)]/50 px-4 py-6 text-center">
              <h2 className="m-0 text-sm font-semibold text-[var(--text)]">Automatic Mode</h2>
              <p className="m-0 mt-2 text-xs text-[var(--muted)] max-w-xl mx-auto leading-relaxed">
                No size or price pre-filter. Click <strong className="text-[var(--text)]">Verify / Test
                Audio Access</strong>, then <strong className="text-[var(--text)]">Start Listening</strong>.
                When you grab/drag Mystery Cargo, we match against all 38 Sound IDs and show{' '}
                <strong className="text-[var(--text)]">size-grouped</strong> results with per-size Red
                chance.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void runVerify()}
                  className="rounded px-3 py-1.5 text-[11px] border border-[var(--border)] text-[var(--text)]"
                >
                  Verify / Test Audio Access
                </button>
                <button
                  type="button"
                  onClick={() => void startCapture()}
                  className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412]"
                >
                  Start Listening
                </button>
                <button
                  type="button"
                  onClick={() => setMode('manual')}
                  className="rounded px-3 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
                >
                  Switch to Manual Mode
                </button>
              </div>
            </div>
          )}

          {hasResult && activeSoundId != null && (
            <SizeGroupedResults
              soundId={activeSoundId}
              items={resultItems}
              matchConfidence={activeMatch?.confidence}
              matchKind={activeMatch?.kind}
              altMatches={matches}
              onPickAlt={(id) => {
                setManualSoundId(id);
              }}
              onClear={clearResult}
              modeLabel={mode === 'automatic' ? 'Automatic match' : 'Manual Sound ID'}
            />
          )}

          {mode === 'manual' && !hasResult && (
            <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              Pick a Sound ID from the board (or Start Listening) to see size-grouped candidates —
              Reds first with Koen and cargo price tiers.
              <div className="mt-2 text-[10px]">
                Filter pool: {filteredManual.length} items · {ALL_SOUND_IDS.length} sounds available
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
