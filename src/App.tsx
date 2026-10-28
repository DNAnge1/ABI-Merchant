import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import merchantData from './data/merchantData.json';
import fingerprintsData from './data/fingerprints.json';
import { StatusBar, type AppMode } from './components/StatusBar';
import { AudioVerifyPanel, playTestTone } from './components/AudioVerifyPanel';
import { ManualFilters } from './components/ManualFilters';
import { SoundBoard, type SoundProfile } from './components/SoundBoard';
import { SizeGroupedResults } from './components/SizeGroupedResults';
import { SetupSelector } from './components/SetupSelector';
import { SingleItemLoop, type SingleLoopPhase } from './components/SingleItemLoop';
import { ContinuousGrid, buildSlotFromMatch, type SessionSlot } from './components/ContinuousGrid';
import { MissFeedbackModal } from './components/MissFeedbackModal';
import { AccuracyPanel } from './components/AccuracyPanel';
import {
  AudioMatcher,
  filterItemsByCargo,
  type FingerprintsFile,
  type MatcherStatus,
  type MatchPayload,
  type MatchResult,
  type MerchantItem,
} from './utils/audioMatcher';
import {
  detectBrowser,
  rmsFromAnalyser,
  supportsGetDisplayMedia,
  type VerifyState,
} from './utils/browserAudio';
import {
  captureDisplayWithAudio,
  DisplayCaptureError,
  isCouldNotStartAudioSource,
} from './utils/displayCapture';
import { redLikelihoodPercent } from './utils/sizeGroups';
import {
  appendCalibrationEvent,
  clearCalibrationEvents,
  computeAccuracyStats,
  downloadCalibrationJson,
  listCalibrationEvents,
  newSessionId,
  type MonitorSetup,
  type ScanStyle,
} from './utils/calibrationStore';
import { alertForMatch } from './utils/soundAlerts';
import { openDocumentPiP, renderPipContent, type PipHandle } from './utils/pipOverlay';

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

interface LockedScan {
  match: MatchResult;
  alt: MatchResult[];
  spectrumVector: number[];
  capturedCentroid: number;
  redPct: number;
  resultItems: MerchantItem[];
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('automatic');
  const [monitorSetup, setMonitorSetup] = useState<MonitorSetup>('dual');
  const [scanStyle, setScanStyle] = useState<ScanStyle>('single');
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [useTts, setUseTts] = useState(true);
  const [size, setSize] = useState('');
  const [cargoType, setCargoType] = useState('');
  const [cargoPrice, setCargoPrice] = useState<number | ''>('');
  const [noiseFloor, setNoiseFloor] = useState(0.18);
  const [status, setStatus] = useState<MatcherStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string>();
  const [capturing, setCapturing] = useState(false);
  const [manualSoundId, setManualSoundId] = useState<number | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>(IDLE_VERIFY);
  const [singlePhase, setSinglePhase] = useState<SingleLoopPhase>('ready');
  const [locked, setLocked] = useState<LockedScan | null>(null);
  const [slots, setSlots] = useState<SessionSlot[]>([]);
  const [missOpen, setMissOpen] = useState(false);
  const [missTarget, setMissTarget] = useState<'locked' | string | null>(null);
  const [statsTick, setStatsTick] = useState(0);
  const [floatOverlay, setFloatOverlay] = useState(false);
  const [sessionId] = useState(() => newSessionId());

  const matcherRef = useRef<AudioMatcher | null>(null);
  const verifyCleanupRef = useRef<(() => void) | null>(null);
  const pipRef = useRef<PipHandle | null>(null);
  const scanStyleRef = useRef(scanStyle);
  const monitorRef = useRef(monitorSetup);
  const matchHandlerRef = useRef<(payload: MatchPayload) => void>(() => undefined);
  const finishLockedRef = useRef<(feedback: 'up' | 'down' | 'skip') => void>(() => undefined);
  const singlePhaseRef = useRef(singlePhase);
  scanStyleRef.current = scanStyle;
  monitorRef.current = monitorSetup;
  singlePhaseRef.current = singlePhase;

  const filteredManual = useMemo(
    () =>
      filterItemsByCargo(items, {
        size: size || undefined,
        cargoType: cargoType || undefined,
        cargoPrice: cargoPrice === '' ? undefined : cargoPrice,
      }),
    [size, cargoType, cargoPrice],
  );

  const stats = useMemo(() => {
    void statsTick;
    return computeAccuracyStats(listCalibrationEvents());
  }, [statsTick]);

  const stopVerifySession = useCallback(() => {
    verifyCleanupRef.current?.();
    verifyCleanupRef.current = null;
  }, []);

  const itemsForSound = useCallback((soundId: number) => {
    return items.filter((i) => i.soundId === soundId);
  }, []);

  const logFeedback = useCallback(
    (opts: {
      predicted: MatchResult;
      redPct: number;
      feedback: 'up' | 'down' | 'skip' | 'dismiss';
      spectrumVector?: number[];
      capturedCentroid?: number;
      actualSoundId?: number;
      actualItemId?: number;
      actualItemName?: string;
    }) => {
      appendCalibrationEvent({
        sessionId,
        appMode: mode,
        monitorSetup: monitorRef.current,
        scanStyle: scanStyleRef.current,
        predictedSoundId: opts.predicted.soundId,
        predictedConfidence: opts.predicted.confidence,
        predictedRedPct: opts.redPct,
        feedback: opts.feedback,
        actualSoundId: opts.actualSoundId,
        actualItemId: opts.actualItemId,
        actualItemName: opts.actualItemName,
        spectrumVector: opts.spectrumVector ?? opts.predicted.spectrumVector,
        spectralCentroid: opts.capturedCentroid ?? opts.predicted.capturedCentroid,
      });
      setStatsTick((n) => n + 1);
    },
    [mode, sessionId],
  );

  const updatePip = useCallback((data: { group: number; confidence: number; redPct: number; status: string }) => {
    if (pipRef.current?.window && !pipRef.current.window.closed) {
      renderPipContent(pipRef.current.window, data);
    }
  }, []);

  const handleMatchPayload = useCallback(
    (payload: MatchPayload) => {
      const top = payload.matches[0];
      if (!top) return;
      const resultItems = itemsForSound(top.soundId);
      const redPct = redLikelihoodPercent(resultItems);

      void alertForMatch({
        soundId: top.soundId,
        redPct,
        enabled: monitorRef.current === 'single' && soundAlerts,
        useTts: useTts,
      });

      updatePip({
        group: top.soundId,
        confidence: top.confidence,
        redPct,
        status: 'Match locked',
      });

      if (mode === 'manual') {
        setManualSoundId(top.soundId);
        setLocked({
          match: top,
          alt: payload.matches,
          spectrumVector: payload.spectrumVector,
          capturedCentroid: payload.capturedCentroid,
          redPct,
          resultItems,
        });
        return;
      }

      if (scanStyleRef.current === 'continuous' && monitorRef.current === 'dual') {
        matcherRef.current?.setListeningPaused(false);
        setSlots((prev) => [buildSlotFromMatch(top, items), ...prev].slice(0, 48));
        return;
      }

      // Style A — single item lock
      matcherRef.current?.setListeningPaused(true);
      setSinglePhase('locked');
      setLocked({
        match: top,
        alt: payload.matches,
        spectrumVector: payload.spectrumVector,
        capturedCentroid: payload.capturedCentroid,
        redPct,
        resultItems,
      });
    },
    [itemsForSound, mode, soundAlerts, updatePip, useTts],
  );

  matchHandlerRef.current = handleMatchPayload;

  useEffect(() => {
    const matcher = new AudioMatcher(fingerprints, {
      noiseFloor: 0.18,
      cooldownMs: 800,
      focusGraceMs: 0,
    });
    matcher.setCallbacks({
      onStatus: (s, detail) => {
        setStatus(s);
        setStatusDetail(detail);
      },
      onMatch: (payload) => matchHandlerRef.current(payload),
    });
    matcher.setCandidates(ALL_SOUND_IDS);
    matcherRef.current = matcher;
    return () => {
      stopVerifySession();
      pipRef.current?.close();
      void matcher.stop();
      matcherRef.current = null;
    };
  }, [stopVerifySession]);

  // Optional UI demos: ?demo=lock | ?demo=grid | ?demo=stats
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (!demo) return;
    if (demo === 'lock' || demo === 'grid') {
      setMode('automatic');
      setMonitorSetup(demo === 'grid' ? 'dual' : 'single');
      setScanStyle(demo === 'grid' ? 'continuous' : 'single');
      const soundId = demo === 'grid' ? 28 : 32;
      const resultItems = items.filter((i) => i.soundId === soundId);
      const redPct = redLikelihoodPercent(resultItems);
      const match: MatchResult = {
        soundId,
        confidence: 91.2,
        kind: 'pickup',
        items: resultItems,
        spectralCentroid: 2800,
        spectrumVector: new Array(32).fill(0.1),
        capturedCentroid: 2800,
      };
      if (demo === 'lock') {
        setCapturing(true);
        setSinglePhase('locked');
        setLocked({
          match,
          alt: [match],
          spectrumVector: match.spectrumVector!,
          capturedCentroid: 2800,
          redPct,
          resultItems,
        });
      } else {
        setCapturing(true);
        setSlots([
          buildSlotFromMatch(match, items),
          buildSlotFromMatch(
            { soundId: 6, confidence: 84, kind: 'drop' },
            items,
          ),
          buildSlotFromMatch(
            { soundId: 14, confidence: 77, kind: 'pickup' },
            items,
          ),
        ]);
      }
    }
    if (demo === 'stats') {
      appendCalibrationEvent({
        sessionId,
        appMode: 'automatic',
        monitorSetup: 'dual',
        scanStyle: 'single',
        predictedSoundId: 32,
        predictedConfidence: 90,
        predictedRedPct: 100,
        feedback: 'up',
      });
      appendCalibrationEvent({
        sessionId,
        appMode: 'automatic',
        monitorSetup: 'dual',
        scanStyle: 'single',
        predictedSoundId: 10,
        predictedConfidence: 70,
        predictedRedPct: 0,
        feedback: 'down',
        actualSoundId: 12,
      });
      setStatsTick((n) => n + 1);
    }
  }, [sessionId]);

  useEffect(() => {
    matcherRef.current?.setNoiseFloor(noiseFloor);
  }, [noiseFloor]);

  useEffect(() => {
    matcherRef.current?.setFocusGraceMs(monitorSetup === 'single' ? 1500 : 0);
  }, [monitorSetup]);

  useEffect(() => {
    matcherRef.current?.setCooldownMs(scanStyle === 'continuous' ? 600 : 900);
  }, [scanStyle]);

  useEffect(() => {
    if (monitorSetup === 'single' && scanStyle === 'continuous') {
      setScanStyle('single');
    }
  }, [monitorSetup, scanStyle]);

  function finishLocked(
    feedback: 'up' | 'down' | 'skip',
    actual?: { soundId: number; itemId?: number; itemName?: string },
  ) {
    if (!locked) return;
    logFeedback({
      predicted: locked.match,
      redPct: locked.redPct,
      feedback,
      spectrumVector: locked.spectrumVector,
      capturedCentroid: locked.capturedCentroid,
      actualSoundId: actual?.soundId,
      actualItemId: actual?.itemId,
      actualItemName: actual?.itemName,
    });
    setLocked(null);
    setSinglePhase('ready');
    setMissOpen(false);
    setMissTarget(null);
    matcherRef.current?.setListeningPaused(false);
    updatePip({ group: 0, confidence: 0, redPct: 0, status: 'Ready' });
  }

  finishLockedRef.current = (fb) => finishLocked(fb);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (singlePhaseRef.current !== 'locked') return;
      if (e.code === 'Space' || e.code === 'Escape') {
        e.preventDefault();
        finishLockedRef.current('skip');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

    // Sync under click: AudioContext before any await
    const gestureCtx = new AudioContext();
    void gestureCtx.resume();

    setVerifyState({
      phase: 'prompting',
      message: 'Share a Chrome tab (preferred) or Entire Screen — enable audio…',
      rms: 0,
      peakRms: 0,
      hasAudioTrack: false,
    });

    let boot;
    try {
      boot = await captureDisplayWithAudio(gestureCtx);
    } catch (err) {
      await gestureCtx.close().catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      const detail =
        err instanceof DisplayCaptureError
          ? JSON.stringify(err.diagnostics, null, 2)
          : undefined;
      const noAudio = /No Audio Track/i.test(msg);
      const couldNotStart = isCouldNotStartAudioSource(err) || /Could not start audio source/i.test(msg);
      setVerifyState({
        phase: noAudio ? 'no-audio' : 'error',
        message: couldNotStart
          ? `Could not start audio source (Chromium/OS loopback failed). ${msg}`
          : msg,
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
        detail,
      });
      return;
    }

    const { stream, ctx } = boot;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    let peak = 0;
    let raf = 0;
    const started = performance.now();
    const tick = () => {
      const rms = rmsFromAnalyser(analyser);
      peak = Math.max(peak, rms);
      const elapsed = performance.now() - started;
      setVerifyState({
        phase: elapsed < 3000 ? 'metering' : 'ok',
        message:
          elapsed < 3000
            ? 'Sampling… move over ABI items or make game sound'
            : `Audio track OK · ctx=${ctx.state} · tracks=${stream.getAudioTracks().length}`,
        rms,
        peakRms: peak,
        hasAudioTrack: true,
        detail: JSON.stringify(boot.diagnostics, null, 2),
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const cleanup = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
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
      setLocked(null);
      setSinglePhase('ready');
      setManualSoundId(null);
      matcherRef.current?.setFocusGraceMs(monitorSetup === 'single' ? 1500 : 0);
      matcherRef.current?.setCooldownMs(scanStyle === 'continuous' ? 600 : 900);
      await matcherRef.current?.startCapture();
      setCapturing(true);
    } catch (err) {
      setCapturing(false);
      const msg = err instanceof Error ? err.message : String(err);
      const detail =
        err instanceof DisplayCaptureError
          ? JSON.stringify(err.diagnostics, null, 2)
          : undefined;
      setStatus('error');
      setStatusDetail(msg);
      setVerifyOpen(true);
      const couldNotStart =
        isCouldNotStartAudioSource(err) || /Could not start audio source/i.test(msg);
      setVerifyState({
        phase: /No Audio Track/i.test(msg)
          ? 'no-audio'
          : /not supported/i.test(msg)
            ? 'unsupported'
            : 'error',
        message: couldNotStart
          ? `Could not start audio source — Chromium could not open system audio loopback. Prefer “Chrome Tab” + Share tab audio. Details: ${msg}`
          : msg,
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
        detail,
      });
    }
  }

  async function stopCapture() {
    await matcherRef.current?.stop();
    setCapturing(false);
    setSinglePhase('ready');
  }

  function switchToManual() {
    stopVerifySession();
    setMode('manual');
    setVerifyOpen(false);
    void stopCapture();
  }

  async function popOutOverlay() {
    const handle = await openDocumentPiP({ width: 360, height: 220 });
    if (handle) {
      pipRef.current = handle;
      renderPipContent(handle.window, {
        group: locked?.match.soundId ?? 0,
        confidence: locked?.match.confidence ?? 0,
        redPct: locked?.redPct ?? 0,
        status: locked ? 'Locked' : capturing ? 'Ready' : 'Idle',
      });
    } else {
      setFloatOverlay(true);
    }
  }

  const hasResult =
    (mode === 'automatic' && scanStyle === 'single' && singlePhase === 'locked' && !!locked) ||
    (mode === 'manual' && (manualSoundId != null || !!locked));

  const displayRed =
    locked?.redPct ??
    (manualSoundId != null ? redLikelihoodPercent(itemsForSound(manualSoundId)) : null);

  const manualResultItems = useMemo(() => {
    const sid = manualSoundId ?? locked?.match.soundId;
    if (sid == null) return [];
    let list = itemsForSound(sid);
    if (size || cargoType || cargoPrice !== '') {
      list = list.filter((i) => {
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
    return list;
  }, [manualSoundId, locked, size, cargoType, cargoPrice, itemsForSound]);

  return (
    <div className="min-h-full flex flex-col">
      <StatusBar
        status={hasResult ? 'done' : status}
        mode={mode}
        detail={
          hasResult && locked
            ? `Group #${locked.match.soundId} · RED ${locked.redPct}% · ${locked.match.confidence}% audio`
            : statusDetail
        }
        capturing={capturing}
        hasResult={!!hasResult}
        redPct={displayRed}
        onModeChange={setMode}
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
          mode === 'manual' ? 'lg:grid-cols-[300px_1fr]' : 'lg:grid-cols-1',
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
              activeSoundId={manualSoundId ?? locked?.match.soundId}
              onPickSound={(id) => {
                setManualSoundId(id);
                setLocked(null);
                setSinglePhase('ready');
              }}
            />
            <AccuracyPanel
              stats={stats}
              onExport={() => downloadCalibrationJson(sessionId)}
              onClear={() => {
                clearCalibrationEvents();
                setStatsTick((n) => n + 1);
              }}
            />
          </aside>
        )}

        <section className="min-w-0 flex flex-col gap-3">
          {mode === 'automatic' && (
            <>
              <SetupSelector
                monitorSetup={monitorSetup}
                scanStyle={scanStyle}
                soundAlerts={soundAlerts}
                useTts={useTts}
                onMonitorSetup={setMonitorSetup}
                onScanStyle={setScanStyle}
                onSoundAlerts={setSoundAlerts}
                onUseTts={setUseTts}
                onPopOut={() => void popOutOverlay()}
              />
              <AccuracyPanel
                stats={stats}
                onExport={() => downloadCalibrationJson(sessionId)}
                onClear={() => {
                  clearCalibrationEvents();
                  setStatsTick((n) => n + 1);
                }}
              />

              {scanStyle === 'single' || monitorSetup === 'single' ? (
                <SingleItemLoop
                  phase={singlePhase}
                  capturing={capturing}
                  match={locked?.match ?? null}
                  resultItems={locked?.resultItems ?? []}
                  altMatches={locked?.alt}
                  onThumbsUp={() => finishLocked('up')}
                  onThumbsDown={() => {
                    setMissTarget('locked');
                    setMissOpen(true);
                  }}
                  onSkip={() => finishLocked('skip')}
                  onPickAlt={(id) => {
                    if (!locked) return;
                    const resultItems = itemsForSound(id);
                    const redPct = redLikelihoodPercent(resultItems);
                    const alt = locked.alt.find((m) => m.soundId === id) || {
                      ...locked.match,
                      soundId: id,
                    };
                    setLocked({
                      ...locked,
                      match: alt,
                      redPct,
                      resultItems,
                    });
                  }}
                />
              ) : (
                <ContinuousGrid
                  slots={slots}
                  listening={capturing}
                  onThumbsUp={(id) => {
                    const slot = slots.find((s) => s.id === id);
                    if (!slot) return;
                    logFeedback({
                      predicted: {
                        soundId: slot.soundId,
                        confidence: slot.confidence,
                        kind: slot.kind as 'pickup' | 'drop',
                        items: slot.items,
                        spectralCentroid: 0,
                      },
                      redPct: slot.redPct,
                      feedback: 'up',
                    });
                    setSlots((prev) => prev.filter((s) => s.id !== id));
                  }}
                  onThumbsDown={(id) => {
                    setMissTarget(id);
                    setMissOpen(true);
                  }}
                  onDismiss={(id) => {
                    const slot = slots.find((s) => s.id === id);
                    if (slot) {
                      logFeedback({
                        predicted: {
                          soundId: slot.soundId,
                          confidence: slot.confidence,
                          kind: slot.kind as 'pickup' | 'drop',
                          items: slot.items,
                          spectralCentroid: 0,
                        },
                        redPct: slot.redPct,
                        feedback: 'dismiss',
                      });
                    }
                    setSlots((prev) => prev.filter((s) => s.id !== id));
                  }}
                  onClearAll={() => setSlots([])}
                  onNewMerchant={() => setSlots([])}
                />
              )}
            </>
          )}

          {mode === 'manual' && (manualSoundId != null || locked) && (
            <SizeGroupedResults
              soundId={(manualSoundId ?? locked!.match.soundId)!}
              items={manualResultItems}
              matchConfidence={locked?.match.confidence}
              matchKind={locked?.match.kind}
              modeLabel="Manual Sound ID"
              onClear={() => {
                setManualSoundId(null);
                setLocked(null);
              }}
            />
          )}

          {mode === 'manual' && manualSoundId == null && !locked && (
            <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              Pick a Sound ID or Start Listening. 👍/👎 from Automatic Mode feed Accuracy Stats.
            </div>
          )}
        </section>
      </main>

      {floatOverlay && (
        <div className="fixed bottom-3 right-3 z-40 w-56 rounded border border-[var(--accent)] bg-[var(--bg-elevated)] p-3 shadow-xl">
          <div className="flex justify-between text-[10px] text-[var(--muted)]">
            <span>Mini-overlay (fallback)</span>
            <button type="button" onClick={() => setFloatOverlay(false)}>
              ✕
            </button>
          </div>
          <div className="mt-1 text-sm font-bold text-[var(--accent)]">
            Group #{locked?.match.soundId ?? '—'}
          </div>
          <div className="text-2xl font-bold text-[var(--mythic)]">{locked?.redPct ?? 0}%</div>
          <div className="text-[10px] text-[var(--muted)]">Red chance · PiP unavailable</div>
        </div>
      )}

      <MissFeedbackModal
        open={missOpen}
        predictedSoundId={
          missTarget === 'locked'
            ? locked?.match.soundId ?? 1
            : slots.find((s) => s.id === missTarget)?.soundId ?? 1
        }
        items={items}
        onCancel={() => {
          setMissOpen(false);
          setMissTarget(null);
        }}
        onSubmit={(actual) => {
          if (missTarget === 'locked') {
            finishLocked('down', actual);
          } else if (typeof missTarget === 'string') {
            const slot = slots.find((s) => s.id === missTarget);
            if (slot) {
              logFeedback({
                predicted: {
                  soundId: slot.soundId,
                  confidence: slot.confidence,
                  kind: slot.kind as 'pickup' | 'drop',
                  items: slot.items,
                  spectralCentroid: 0,
                },
                redPct: slot.redPct,
                feedback: 'down',
                actualSoundId: actual.soundId,
                actualItemId: actual.itemId,
                actualItemName: actual.itemName,
              });
              setSlots((prev) => prev.filter((s) => s.id !== missTarget));
            }
            setMissOpen(false);
            setMissTarget(null);
          }
        }}
      />
    </div>
  );
}
