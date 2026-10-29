import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import merchantData from './data/merchantData.json';
import fingerprintsData from './data/fingerprints.json';
import type { AppMode } from './components/StatusBar';
import { AudioVerifyPanel, playTestTone } from './components/AudioVerifyPanel';
import { ManualFilters } from './components/ManualFilters';
import { SoundBoard, type SoundProfile } from './components/SoundBoard';
import { SizeGroupedResults } from './components/SizeGroupedResults';
import { buildSlotFromMatch, type SessionSlot } from './components/ContinuousGrid';
import {
  ActiveSessionError,
  BurstCaptureControls,
  SessionErrorHistory,
  type SessionErrorEntry,
} from './components/SessionErrorHistory';
import { MissFeedbackModal } from './components/MissFeedbackModal';
import { AccuracyPanel } from './components/AccuracyPanel';
import { SelftestPanel } from './components/SelftestPanel';
import { ChromeBar } from './components/ChromeBar';
import { EntryScreen } from './components/EntryScreen';
import { AutoWizard, type AutoSettings } from './components/AutoWizard';
import { StepRow, type WizardStep } from './components/StepRow';
import { ListenCircle } from './components/ListenCircle';
import { LatestLockFeed } from './components/LatestLockFeed';
import {
  TroubleshootingPage,
  type TroubleSection,
} from './components/TroubleshootingPage';
import { WipAccuracyBanner } from './components/WipAccuracyBanner';
import type { SingleLoopPhase } from './components/SingleItemLoop';
import {
  analyserFftSize,
  AudioMatcher,
  filterItemsByCargo,
  MULTI_SPIKE_TARGET_N,
  type FingerprintsFile,
  type MatcherStatus,
  type MatchPayload,
  type MatchResult,
  type MerchantItem,
  type MultiScanProgress,
} from './utils/audioMatcher';
import {
  runBrowserAnalyserSelftest,
  type SelftestReport,
} from './utils/browserSelftest';
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
  type BootstrappedCapture,
} from './utils/displayCapture';
import { captureMicWithAudio } from './utils/micCapture';
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
import { type SensitivityLevel } from './utils/sensitivity';

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
  const [shellScreen, setShellScreen] = useState<
    'entry' | 'wizard' | 'listen' | 'manual' | 'troubleshooting'
  >('entry');
  const [wizardStep, setWizardStep] = useState<WizardStep>('monitors');
  const [monitorSetup, setMonitorSetup] = useState<MonitorSetup | null>(null);
  const [scanStyle, setScanStyle] = useState<ScanStyle>('single');
  const [hideImages, setHideImages] = useState(false);
  const [focusGuard, setFocusGuard] = useState(true);
  const [onlyRed, setOnlyRed] = useState(false);
  const [onlyYellow, setOnlyYellow] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [troubleSection, setTroubleSection] =
    useState<TroubleSection>('overview');
  const [troubleReturn, setTroubleReturn] = useState<
    'entry' | 'wizard' | 'listen' | 'manual'
  >('entry');
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [useTts, setUseTts] = useState(true);
  const [size, setSize] = useState('');
  const [cargoType, setCargoType] = useState('');
  const [cargoPrice, setCargoPrice] = useState<number | ''>('');
  const [noiseFloor, setNoiseFloor] = useState(0.2);
  /** Default Med; mic/loopback applies one notch stricter inside the matcher. */
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('med');
  const [captureSource, setCaptureSource] = useState<'display' | 'microphone' | null>(
    null,
  );
  const [status, setStatus] = useState<MatcherStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string>();
  const [capturing, setCapturing] = useState(false);
  const [atShop, setAtShop] = useState(false);
  const [recordingMove, setRecordingMove] = useState(false);
  const [shopCalibrating, setShopCalibrating] = useState(false);
  const [multiArmed, setMultiArmed] = useState(false);
  const [multiProgress, setMultiProgress] = useState<MultiScanProgress>({
    spikeCount: 0,
    targetN: MULTI_SPIKE_TARGET_N,
    phase: 'idle',
  });
  const multiProgressRef = useRef(multiProgress);
  multiProgressRef.current = multiProgress;
  const [shopToast, setShopToast] = useState<string | null>(null);
  /** Multi identify-fail toast stays until next lock / dismiss / leave shop */
  const [shopToastSticky, setShopToastSticky] = useState(false);
  const shopToastStickyRef = useRef(false);
  shopToastStickyRef.current = shopToastSticky;
  /** Collapsed session fail history — survives re-arm / toast dismiss (not cleared on move 3×). */
  const [sessionErrors, setSessionErrors] = useState<SessionErrorEntry[]>([]);
  const [burstCaptureUrl, setBurstCaptureUrl] = useState<string | null>(null);
  const [burstCaptureMs, setBurstCaptureMs] = useState(0);
  const burstCaptureBlobRef = useRef<Blob | null>(null);
  const burstCaptureUrlRef = useRef<string | null>(null);
  const burstAudioRef = useRef<HTMLAudioElement | null>(null);
  const [manualSoundId, setManualSoundId] = useState<number | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>(IDLE_VERIFY);
  const [suggestMicFallback, setSuggestMicFallback] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [selftestOpen, setSelftestOpen] = useState(false);
  const [selftestRunning, setSelftestRunning] = useState(false);
  const [selftestProgress, setSelftestProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [selftestReport, setSelftestReport] = useState<SelftestReport | null>(null);
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
  const monitorRef = useRef<MonitorSetup>(monitorSetup ?? 'dual');
  const matchHandlerRef = useRef<(payload: MatchPayload) => void>(() => undefined);
  const finishLockedRef = useRef<(feedback: 'up' | 'down' | 'skip') => void>(() => undefined);
  const singlePhaseRef = useRef(singlePhase);
  scanStyleRef.current = scanStyle;
  monitorRef.current = monitorSetup ?? 'dual';
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

  const runSelftest = useCallback(async () => {
    setSelftestOpen(true);
    setSelftestRunning(true);
    setSelftestProgress({ done: 0, total: 38 });
    try {
      const report = await runBrowserAnalyserSelftest(fingerprints, (done, total) => {
        setSelftestProgress({ done, total });
      });
      setSelftestReport(report);
    } catch (err) {
      setSelftestReport({
        ok: false,
        passed: 0,
        total: 0,
        passRate: 0,
        sampleRate: 0,
        fftSize: 0,
        rows: [],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      console.error('Self-test failed', err);
    } finally {
      setSelftestRunning(false);
    }
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

  const isFailDiagnostic = useCallback((msg: string) => {
    return /ambiguous|weak match|no fingerprint|failed|error|reject|too quiet|need ≥|no candidates/i.test(
      msg,
    );
  }, []);

  const pushSessionError = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed || !isFailDiagnostic(trimmed)) return;
    setSessionErrors((prev) => {
      // Dedupe consecutive identical messages (re-arm spam).
      if (prev[0]?.message === trimmed) return prev;
      const entry: SessionErrorEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        message: trimmed,
      };
      return [entry, ...prev].slice(0, 40);
    });
  }, [isFailDiagnostic]);
  const pushSessionErrorRef = useRef(pushSessionError);
  pushSessionErrorRef.current = pushSessionError;

  const handleMatchPayload = useCallback(
    (payload: MatchPayload) => {
      const top = payload.matches[0];
      if (!top) {
        const msg = 'Match produced no candidates — try Stop & Match again.';
        setShopToast(msg);
        pushSessionError(msg);
        return;
      }
      const isBurst = payload.source === 'burst';
      // Burst uses a softer floor inside the matcher; auto keeps the full floor.
      const floor = isBurst
        ? Math.max(48, (matcherRef.current?.getMinConfidence() ?? 60) - 8)
        : Math.max(matcherRef.current?.getMinConfidence() ?? 60, 68);
      if (top.confidence < floor) {
        const msg = `${isBurst ? 'Stop & Match' : 'Auto'}: weak match Group #${top.soundId} at ${top.confidence}% (need ≥${floor}%).`;
        setStatus('listening');
        setStatusDetail(msg);
        setShopToast(msg);
        pushSessionError(msg);
        return;
      }
      setShopToast(null);
      setShopToastSticky(false);
      if (payload.captureBlob) {
        adoptBurstCapture(payload.captureBlob, payload.captureDurationMs ?? 0);
      }
      // Multi keeps recordingMove true (re-arms after cooldown); single stops.
      if (!(scanStyleRef.current === 'continuous' && monitorRef.current === 'dual')) {
        setRecordingMove(false);
      }
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
    [itemsForSound, mode, pushSessionError, soundAlerts, updatePip, useTts],
  );

  matchHandlerRef.current = handleMatchPayload;

  useEffect(() => {
    const matcher = new AudioMatcher(fingerprints, {
      sensitivity: 'med',
      cooldownMs: 800,
      focusGraceMs: 0,
      // Field Merchant only plays pickup when dragging cargo.
      kind: 'pickup',
    });
    matcher.setCallbacks({
      onStatus: (s, detail) => {
        setStatus(s);
        setStatusDetail(detail);
        // Track ended / capture death: matcher already stopped — sync UI so Retest works.
        if (s === 'error') {
          setCapturing(false);
          setCaptureSource(null);
          setRecordingMove(false);
          setMultiArmed(false);
          setAtShop(false);
          if (detail) pushSessionErrorRef.current(detail);
          if (
            detail &&
            /track ended|headphones|speakers|G560|output device|Capture window closed/i.test(
              detail,
            )
          ) {
            setSuggestMicFallback(true);
          }
        }
      },
      onMatch: (payload) => matchHandlerRef.current(payload),
      onMultiProgress: (p) => {
        setMultiProgress(p);
        setMultiArmed(p.phase !== 'idle');
        if (!p.detail) return;
        const failLike =
          /ambiguous|weak match|no fingerprint|failed|error|reject|too quiet|need ≥/i.test(
            p.detail,
          );
        const rearmIdle =
          p.phase === 'armed' && /Ready for next cargo/i.test(p.detail);
        if (failLike) {
          setShopToastSticky(true);
          setShopToast(p.detail);
          pushSessionErrorRef.current(p.detail);
          return;
        }
        // Don't wipe a sticky fail with a brief "Ready for next cargo" flash.
        if (rearmIdle && shopToastStickyRef.current) {
          setShopToast(
            (prev) =>
              `${prev ?? 'Identify failed — try again'}\n——\n${p.detail}`,
          );
          return;
        }
        if (!shopToastStickyRef.current) setShopToast(p.detail);
      },
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

  // Optional UI demos: ?demo=lock | ?demo=grid | ?demo=stats | ?demo=shop | ?demo=shop-record
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (!demo) return;
    if (demo === 'shop' || demo === 'shop-record') {
      setMode('automatic');
      setShellScreen('listen');
      setWizardStep('listen');
      setMonitorSetup('dual');
      setScanStyle('single');
      setCapturing(true);
      setAtShop(demo === 'shop-record' || demo === 'shop');
      setRecordingMove(demo === 'shop-record');
      setStatus('listening');
      setStatusDetail(
        demo === 'shop-record'
          ? 'Recording moves… drag the same Mystery Cargo a few times, then Stop & Match'
          : demo === 'shop'
            ? 'At Shop (open) · baseline locked — use Manual Move Scan'
            : 'In Raid (gate closed)',
      );
      // shop with atShop false for gate-closed: use ?demo=raid
      return;
    }
    if (demo === 'raid') {
      setMode('automatic');
      setShellScreen('listen');
      setMonitorSetup('single');
      setCapturing(true);
      setAtShop(false);
      setRecordingMove(false);
      setStatus('listening');
      setStatusDetail('In Raid (gate closed) — raid noise ignored until At Shop / Move Item');
      return;
    }
    if (demo === 'lock' || demo === 'grid') {
      setMode('automatic');
      setShellScreen('listen');
      setWizardStep('listen');
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
    matcherRef.current?.setSensitivity(sensitivity);
  }, [sensitivity]);

  useEffect(() => {
    // Manual Mode slider remains an advanced override when not in auto listening.
    if (mode === 'manual') matcherRef.current?.setNoiseFloor(noiseFloor);
  }, [noiseFloor, mode]);

  useEffect(() => {
    matcherRef.current?.setFocusGraceMs(
      focusGuard && monitorSetup === 'single' ? 1500 : 0,
    );
  }, [monitorSetup, focusGuard]);

  useEffect(() => {
    matcherRef.current?.setCooldownMs(scanStyle === 'continuous' ? 600 : 900);
  }, [scanStyle]);

  useEffect(() => {
    if (!capturing) setCaptureSource(null);
    else setCaptureSource(matcherRef.current?.getCaptureSource() ?? null);
  }, [capturing, status]);

  useEffect(() => {
    if (monitorSetup === 'single' && scanStyle === 'continuous') {
      setScanStyle('single');
    }
  }, [monitorSetup, scanStyle]);

  // Leaving Dual+Multi disarms continuous spike session.
  useEffect(() => {
    if (scanStyle === 'continuous' && monitorSetup === 'dual') return;
    if (!multiArmed) return;
    void matcherRef.current?.stopMultiContinuous({ match: false });
    setMultiArmed(false);
    setRecordingMove(false);
    setMultiProgress({
      spikeCount: 0,
      targetN: MULTI_SPIKE_TARGET_N,
      phase: 'idle',
    });
  }, [scanStyle, monitorSetup, multiArmed]);

  useEffect(() => {
    return () => {
      if (burstCaptureUrlRef.current) URL.revokeObjectURL(burstCaptureUrlRef.current);
    };
  }, []);

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
    // Stay burst-only after feedback — don't leave auto-onset hot for heals.
    matcherRef.current?.setAutoDetectArmed(false);
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

  function attachVerifyMeter(boot: BootstrappedCapture) {
    const { stream, ctx } = boot;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = analyserFftSize(ctx.sampleRate);
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    let peak = 0;
    let raf = 0;
    const via = boot.sourceKind === 'microphone' ? 'mic/loopback' : 'screen share';

    setSuggestMicFallback(false);
    setVerifyState({
      phase: 'waiting',
      message: `Audio track connected (${via}) — waiting for merchant sounds (OK if not in raid yet)`,
      rms: 0,
      peakRms: 0,
      hasAudioTrack: true,
      detail: JSON.stringify(boot.diagnostics, null, 2),
    });

    const tick = () => {
      const rms = rmsFromAnalyser(analyser);
      peak = Math.max(peak, rms);
      setVerifyState((prev) => ({
        ...prev,
        phase: 'waiting',
        message:
          peak < 0.02
            ? `Listening (${via})… no signal yet (fine in lobby). Reach Field Merchant when ready.`
            : `Listening (${via})… signal seen · ctx=${ctx.state} · audioTracks=${stream.getAudioTracks().length}`,
        rms,
        peakRms: peak,
        hasAudioTrack: true,
      }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const failTrackEnded = () => {
      cancelAnimationFrame(raf);
      setVerifyState({
        phase: 'error',
        message:
          boot.sourceKind === 'microphone'
            ? 'Mic / loopback track ended — pick the input again.'
            : 'Audio track ended — re-share with tab/system audio, or use mic / loopback.',
        rms: 0,
        peakRms: peak,
        hasAudioTrack: false,
      });
      if (boot.sourceKind === 'display') setSuggestMicFallback(true);
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
      verifyCleanupRef.current = null;
    };

    const cleanup = () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    };
    verifyCleanupRef.current = cleanup;
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', cleanup));
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', failTrackEnded));
  }

  async function runVerify() {
    stopVerifySession();
    setSuggestMicFallback(false);
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
      const couldNotStart =
        isCouldNotStartAudioSource(err) || /Could not start audio source/i.test(msg);
      if (couldNotStart || noAudio) setSuggestMicFallback(true);
      setVerifyState({
        phase: noAudio ? 'no-audio' : 'error',
        message: couldNotStart
          ? `Could not start audio source (OS loopback failed — common with G560). Next: Mic / loopback below. Chrome Tab won’t capture ABI game audio. ${msg}`
          : msg,
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
        detail,
      });
      return;
    }

    attachVerifyMeter(boot);
  }

  /** Verify meter via getUserMedia mic / virtual loopback (no getDisplayMedia). */
  async function runVerifyMic(deviceId?: string) {
    stopVerifySession();
    setMicBusy(true);
    setVerifyOpen(true);
    setVerifyState({
      phase: 'prompting',
      message: 'Opening microphone / loopback device…',
      rms: 0,
      peakRms: 0,
      hasAudioTrack: false,
    });

    const gestureCtx = new AudioContext();
    void gestureCtx.resume();

    try {
      const boot = await captureMicWithAudio(deviceId, gestureCtx);
      attachVerifyMeter(boot);
    } catch (err) {
      await gestureCtx.close().catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      const detail =
        err instanceof DisplayCaptureError
          ? JSON.stringify(err.diagnostics, null, 2)
          : undefined;
      setSuggestMicFallback(true);
      setVerifyState({
        phase: 'error',
        message: msg,
        rms: 0,
        peakRms: 0,
        hasAudioTrack: false,
        detail,
      });
    } finally {
      setMicBusy(false);
    }
  }

  function prepareMatcherSession() {
    setLocked(null);
    setSinglePhase('ready');
    setManualSoundId(null);
    setAtShop(false);
    setRecordingMove(false);
    setShopCalibrating(false);
    setShopToast(null);
    matcherRef.current?.setSensitivity(sensitivity);
    matcherRef.current?.setFocusGraceMs(
      focusGuard && monitorSetup === 'single' ? 1500 : 0,
    );
    matcherRef.current?.setCooldownMs(scanStyle === 'continuous' ? 600 : 900);
  }

  function openCaptureFailure(err: unknown) {
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
    const noAudio = /No Audio Track/i.test(msg);
    if (couldNotStart || noAudio) setSuggestMicFallback(true);
    setVerifyState({
      phase: noAudio
        ? 'no-audio'
        : /not supported/i.test(msg)
          ? 'unsupported'
          : 'error',
      message: couldNotStart
        ? `Could not start audio source — OS loopback failed (common with G560). Next: Mic / loopback below (VB-Cable / Stereo Mix). Chrome Tab won’t capture ABI desktop game audio. Details: ${msg}`
        : msg,
      rms: 0,
      peakRms: 0,
      hasAudioTrack: false,
      detail,
    });
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
    setSuggestMicFallback(false);
    setVerifyOpen(false);
    try {
      prepareMatcherSession();
      await matcherRef.current?.startCapture();
      setCapturing(true);
      setCaptureSource(matcherRef.current?.getCaptureSource() ?? 'display');
    } catch (err) {
      setCapturing(false);
      setCaptureSource(null);
      openCaptureFailure(err);
    }
  }

  /** Live Automatic Mode via mic / virtual loopback (same matcher pipeline). */
  async function startCaptureFromMic(deviceId?: string) {
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
    setMicBusy(true);
    setVerifyOpen(false);
    // Mic/loopback defaults to stricter Low unless the user already chose High.
    const micLevel: SensitivityLevel = sensitivity === 'high' ? 'high' : 'low';
    setSensitivity(micLevel);
    try {
      prepareMatcherSession();
      matcherRef.current?.setSensitivity(micLevel);
      await matcherRef.current?.startCaptureFromMic(deviceId);
      setCapturing(true);
      setCaptureSource('microphone');
      setSuggestMicFallback(false);
    } catch (err) {
      setCapturing(false);
      setCaptureSource(null);
      openCaptureFailure(err);
    } finally {
      setMicBusy(false);
    }
  }

  async function stopCapture(opts?: { keepError?: boolean }) {
    await matcherRef.current?.stop({ skipStatus: opts?.keepError === true });
    setCapturing(false);
    setCaptureSource(null);
    setAtShop(false);
    setRecordingMove(false);
    setShopCalibrating(false);
    setMultiArmed(false);
    setShopToast(null);
    clearBurstCapture();
    setSinglePhase('ready');
    if (!opts?.keepError) {
      setStatus('idle');
      setStatusDetail(undefined);
    }
  }

  /** Close verify overlay + reset error status so chrome / Start over / Retest work. */
  function clearAudioErrorState() {
    stopVerifySession();
    setVerifyOpen(false);
    setSuggestMicFallback(false);
    setVerifyState(IDLE_VERIFY);
    setMicBusy(false);
    setStatus('idle');
    setStatusDetail(undefined);
  }

  async function retestListening() {
    clearAudioErrorState();
    await stopCapture();
    setStatus('idle');
    if (shellScreen === 'entry' || shellScreen === 'troubleshooting') {
      if (monitorSetup) {
        setShellScreen('listen');
        setWizardStep('listen');
        setMode('automatic');
      } else {
        setShellScreen('wizard');
        setWizardStep('monitors');
        setMode('automatic');
        return;
      }
    }
    await startCapture();
  }

  async function handleToggleAtShop() {
    if (!matcherRef.current || !capturing) return;
    try {
      if (atShop) {
        await matcherRef.current.setAtShop(false);
        setAtShop(false);
        setMultiArmed(false);
        setRecordingMove(false);
        setMultiProgress({
          spikeCount: 0,
          targetN: MULTI_SPIKE_TARGET_N,
          phase: 'idle',
        });
        setShopToast('Left At Shop — listening paused (raid muted).');
        setShopToastSticky(false);
        return;
      }
      setShopCalibrating(true);
      setShopToast(null);
      await matcherRef.current.setAtShop(true);
      setAtShop(true);
      setShopToast(
        scanStyleRef.current === 'continuous' && monitorRef.current === 'dual'
          ? 'At Shop ready — Arm Multi scan (counts 2–3 moves → grid).'
          : 'At Shop ready — use Start Moving Item → Stop & Match (auto-detect off).',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setStatusDetail(msg);
      setShopToast(msg);
    } finally {
      setShopCalibrating(false);
    }
  }

  function clearBurstCapture() {
    if (burstCaptureUrlRef.current) {
      URL.revokeObjectURL(burstCaptureUrlRef.current);
      burstCaptureUrlRef.current = null;
    }
    setBurstCaptureUrl(null);
    setBurstCaptureMs(0);
    burstCaptureBlobRef.current = null;
    if (burstAudioRef.current) {
      burstAudioRef.current.pause();
      burstAudioRef.current = null;
    }
  }

  function adoptBurstCapture(blob: Blob | null, durationMs: number) {
    clearBurstCapture();
    if (!blob) return;
    burstCaptureBlobRef.current = blob;
    setBurstCaptureMs(durationMs);
    const url = URL.createObjectURL(blob);
    burstCaptureUrlRef.current = url;
    setBurstCaptureUrl(url);
  }

  function playBurstCapture() {
    if (!burstCaptureUrl) return;
    if (burstAudioRef.current) {
      burstAudioRef.current.pause();
      burstAudioRef.current = null;
    }
    const audio = new Audio(burstCaptureUrl);
    burstAudioRef.current = audio;
    void audio.play().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setShopToast(`Could not play captured audio: ${msg}`);
    });
  }

  function downloadBurstCapture() {
    const blob = burstCaptureBlobRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `abi-burst-capture-${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleStartMoveBurst() {
    if (!matcherRef.current || !capturing) return;
    try {
      setShopCalibrating(!atShop);
      setShopToast(null);
      clearBurstCapture();
      await matcherRef.current.startItemMoveBurst();
      setAtShop(true);
      setRecordingMove(true);
      setLocked(null);
      setSinglePhase('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setStatusDetail(msg);
      setShopToast(msg);
    } finally {
      setShopCalibrating(false);
    }
  }

  async function handleStopMoveBurst() {
    if (!matcherRef.current) {
      setShopToast('Stop & Match: matcher not ready — Start Listening first.');
      return;
    }
    const keepMulti = matcherRef.current.isMultiContinuousArmed();
    setRecordingMove(keepMulti);
    try {
      const result = await matcherRef.current.stopItemMoveBurst();
      adoptBurstCapture(result.captureBlob, result.captureDurationMs);
      // Always toast diagnostics (peak/floor/frames) — never a silent no-op.
      setShopToast(result.reason);
      setStatusDetail(result.reason);
      if (!result.ok) {
        setStatus('listening');
        if (keepMulti) setShopToastSticky(true);
        pushSessionError(result.reason);
      } else {
        setShopToastSticky(false);
      }
      // Dual+Multi Force Stop & Match: cooldown then wait for next cargo.
      if (keepMulti && matcherRef.current.isMultiContinuousArmed()) {
        await matcherRef.current.rearmMultiAfterMatch(result.reason);
        setRecordingMove(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setStatusDetail(msg);
      setShopToast(`Stop & Match error: ${msg}`);
      pushSessionError(`Stop & Match error: ${msg}`);
      setRecordingMove(false);
    }
  }

  async function handleArmMulti() {
    if (!matcherRef.current || !capturing) return;
    try {
      setShopCalibrating(!atShop);
      setShopToast(null);
      clearBurstCapture();
      await matcherRef.current.startMultiContinuous();
      setAtShop(true);
      setMultiArmed(true);
      setRecordingMove(true);
      setLocked(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setStatusDetail(msg);
      setShopToast(msg);
      setMultiArmed(false);
    } finally {
      setShopCalibrating(false);
    }
  }

  async function handleStopMulti() {
    if (!matcherRef.current) return;
    try {
      await matcherRef.current.stopMultiContinuous({ match: false });
      setMultiArmed(false);
      setRecordingMove(false);
      setMultiProgress({
        spikeCount: 0,
        targetN: MULTI_SPIKE_TARGET_N,
        phase: 'idle',
      });
      setShopToast('Multi stopped — still At Shop.');
      setShopToastSticky(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setShopToast(`Stop Multi: ${msg}`);
      setShopToastSticky(true);
    }
  }

  function switchToManual() {
    stopVerifySession();
    setMode('manual');
    setShellScreen('manual');
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
  void popOutOverlay;

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

  const multiMode = scanStyle === 'continuous' && monitorSetup === 'dual';
  // Keep captureSource / statusDetail live for matcher diagnostics (chrome uses capturing).
  void captureSource;
  void statusDetail;

  const autoSettings: AutoSettings = {
    soundAlerts,
    useTts,
    sensitivity,
    hideImages,
    focusGuard,
  };

  function startOver() {
    clearAudioErrorState();
    void stopCapture().then(() => {
      setStatus('idle');
      setStatusDetail(undefined);
    });
    setShellScreen('entry');
    setWizardStep('monitors');
    setMonitorSetup(null);
    setScanStyle('single');
    setMode('automatic');
    setLocked(null);
    setSlots([]);
    setSinglePhase('ready');
    setSelectedSizes([]);
    setShopToast(null);
    setShopToastSticky(false);
  }

  function openTroubleshooting(section: TroubleSection = 'overview') {
    // Close verify overlay so Troubleshooting doesn't hide Start over / options.
    stopVerifySession();
    setVerifyOpen(false);
    setSuggestMicFallback(false);
    if (shellScreen !== 'troubleshooting') {
      setTroubleReturn(
        shellScreen === 'entry' ||
          shellScreen === 'wizard' ||
          shellScreen === 'listen' ||
          shellScreen === 'manual'
          ? shellScreen
          : 'entry',
      );
    }
    setTroubleSection(section);
    setShellScreen('troubleshooting');
  }

  function chooseAutomatic() {
    setMode('automatic');
    setShellScreen('wizard');
    setWizardStep('monitors');
    setMonitorSetup(null);
  }

  function chooseManual() {
    setMode('manual');
    setShellScreen('manual');
  }

  function jumpWizard(step: WizardStep) {
    if (step === 'listen') {
      if (!monitorSetup) {
        setWizardStep('monitors');
        setShellScreen('wizard');
        return;
      }
      setWizardStep('listen');
      setShellScreen('listen');
      return;
    }
    if (step === 'settings' && !monitorSetup) {
      setWizardStep('monitors');
      setShellScreen('wizard');
      return;
    }
    setWizardStep(step);
    setShellScreen('wizard');
  }

  function stepBack() {
    if (wizardStep === 'listen' || shellScreen === 'listen') {
      jumpWizard('settings');
      return;
    }
    if (wizardStep === 'settings') {
      setWizardStep('monitors');
      return;
    }
    startOver();
  }

  function selectMonitors(m: MonitorSetup) {
    setMonitorSetup(m);
    setScanStyle(m === 'dual' ? 'continuous' : 'single');
    setWizardStep('settings');
  }

  function goNextFromSettings() {
    setWizardStep('listen');
    setShellScreen('listen');
  }

  function toggleSize(sizeKey: string) {
    setSelectedSizes((prev) =>
      prev.includes(sizeKey) ? prev.filter((s) => s !== sizeKey) : [...prev, sizeKey],
    );
  }

  function handleModeChange(next: AppMode) {
    if (next === 'manual') {
      chooseManual();
      return;
    }
    if (monitorSetup) {
      setMode('automatic');
      setShellScreen('listen');
      setWizardStep('listen');
    } else {
      chooseAutomatic();
    }
  }

  const latestLock =
    multiMode && slots[0]
      ? {
          soundId: slots[0].soundId,
          confidence: slots[0].confidence,
          items: slots[0].items,
        }
      : locked
        ? {
            soundId: locked.match.soundId,
            confidence: locked.match.confidence,
            items: locked.resultItems,
          }
        : null;

  const activeError = sessionErrors[0] ?? null;
  const hasAudioError =
    verifyOpen ||
    status === 'error' ||
    suggestMicFallback ||
    (!!statusDetail &&
      /NotReadableError|Could not start audio source|track ended|G560/i.test(statusDetail));
  const chromeScreen =
    shellScreen === 'troubleshooting'
      ? 'troubleshooting'
      : shellScreen === 'manual'
        ? 'manual'
        : shellScreen === 'listen'
          ? 'listen'
          : shellScreen === 'wizard'
            ? 'wizard'
            : 'entry';
  const showChrome = shellScreen !== 'entry' || hasAudioError;

  return (
    <div className="min-h-full flex flex-col">
      {showChrome && (
        <ChromeBar
          mode={mode}
          screen={chromeScreen}
          capturing={capturing}
          hasAudioError={hasAudioError}
          onStartOver={startOver}
          onModeChange={handleModeChange}
          onOpenTrouble={() => openTroubleshooting('overview')}
          onStartListening={() => void startCapture()}
          onStopListening={() => void stopCapture()}
          onRetest={() => void retestListening()}
        />
      )}

      <SelftestPanel
        open={selftestOpen}
        running={selftestRunning}
        progress={selftestProgress}
        report={selftestReport}
        onRun={() => void runSelftest()}
        onClose={() => setSelftestOpen(false)}
      />

      <AudioVerifyPanel
        open={verifyOpen}
        state={verifyState}
        suggestMicFallback={suggestMicFallback}
        micBusy={micBusy}
        onClose={() => {
          clearAudioErrorState();
        }}
        onRetry={() => void runVerify()}
        onSwitchManual={switchToManual}
        onPlayTone={() => void playTestTone()}
        onStartListening={() => {
          clearAudioErrorState();
          void startCapture();
        }}
        onRetestListening={() => void retestListening()}
        onStartOver={startOver}
        onUseMicLoopback={(deviceId) => {
          if (suggestMicFallback || verifyState.phase === 'error' || verifyState.phase === 'no-audio') {
            void startCaptureFromMic(deviceId);
          } else {
            void runVerifyMic(deviceId);
          }
        }}
      />

      <main className="flex-1 p-4 md:px-6">
        {shellScreen === 'entry' && (
          <EntryScreen
            onAutomatic={chooseAutomatic}
            onManual={chooseManual}
            onTrouble={() => openTroubleshooting('overview')}
          />
        )}

        {shellScreen === 'wizard' && (
          <AutoWizard
            step={wizardStep === 'listen' ? 'settings' : wizardStep}
            monitorSetup={monitorSetup}
            settings={autoSettings}
            onSelectMonitors={selectMonitors}
            onJump={jumpWizard}
            onBack={stepBack}
            onChangeSettings={(patch) => {
              if (patch.soundAlerts != null) setSoundAlerts(patch.soundAlerts);
              if (patch.useTts != null) setUseTts(patch.useTts);
              if (patch.sensitivity != null) setSensitivity(patch.sensitivity);
              if (patch.hideImages != null) setHideImages(patch.hideImages);
              if (patch.focusGuard != null) setFocusGuard(patch.focusGuard);
            }}
            onNext={goNextFromSettings}
          />
        )}

        {shellScreen === 'listen' && (
          <div className="max-w-[820px] mx-auto flex flex-col gap-5">
            <StepRow
              step="listen"
              onJump={jumpWizard}
              onBack={stepBack}
              backLabel="← Settings"
            />

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-2xl font-medium tracking-tight">Listening</h2>
                <span
                  className={[
                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold border',
                    capturing
                      ? 'border-[var(--listening)]/50 text-[var(--text)] bg-[var(--listening)]/20'
                      : 'border-[var(--border)] text-[var(--muted)]',
                  ].join(' ')}
                >
                  {capturing ? 'Live' : 'Stopped'}
                </span>
                <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold border border-[var(--accent)]/40 text-[var(--text)] bg-[var(--accent-dim)]/30">
                  {monitorSetup === 'dual' ? 'Multi monitors' : 'Single monitor'}
                </span>
                {displayRed != null && hasResult && (
                  <span
                    className={[
                      'rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums',
                      displayRed > 0
                        ? 'bg-[var(--mythic)] text-white'
                        : 'border border-[var(--border)] text-[var(--muted)]',
                    ].join(' ')}
                  >
                    RED {displayRed}%
                  </span>
                )}
              </div>
              <p className="m-0 text-[13px] text-[var(--muted)]">
                Mid-screen circle CTA — step row above for Back / Monitors. Multi always waits for
                3 moves.
              </p>
            </div>

            <WipAccuracyBanner />

            {(status === 'error' || suggestMicFallback) && !verifyOpen && (
              <div
                role="alert"
                className="rounded-lg border border-[var(--warn)]/50 bg-[#2a2208] px-3 py-3 space-y-2"
              >
                <p className="m-0 text-[12px] font-semibold text-[var(--warn)]">
                  Audio capture interrupted
                </p>
                <p className="m-0 text-[12px] text-[var(--text)] leading-relaxed whitespace-pre-wrap">
                  {statusDetail ||
                    'Capture stopped — often after switching headphones ↔ speakers (G560). Retest to reconnect, or open Troubleshooting for Mic / loopback.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void retestListening()}
                    className="rounded px-3 py-1.5 text-[11px] font-semibold bg-[var(--accent)] text-[#041412]"
                  >
                    Retest
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearAudioErrorState();
                      openTroubleshooting('windows');
                    }}
                    className="rounded px-3 py-1.5 text-[11px] font-medium border border-[var(--border)] text-[var(--text)]"
                  >
                    Troubleshooting
                  </button>
                  <button
                    type="button"
                    onClick={() => clearAudioErrorState()}
                    className="rounded px-3 py-1.5 text-[11px] font-medium border border-[var(--border)] text-[var(--muted)]"
                  >
                    Clear error
                  </button>
                  <button
                    type="button"
                    onClick={startOver}
                    className="rounded px-3 py-1.5 text-[11px] font-medium border border-[var(--border)] text-[var(--muted)]"
                  >
                    Start over
                  </button>
                </div>
              </div>
            )}

            <ListenCircle
              capturing={capturing}
              multiMode={multiMode}
              multiArmed={multiArmed}
              moveCount={capturing ? (multiMode ? multiProgress.spikeCount : recordingMove ? 1 : 0) : 0}
              targetN={multiProgress.targetN}
              multiPhase={multiProgress.phase}
              atShop={atShop}
              recordingMove={recordingMove}
              calibrating={shopCalibrating}
              onStartListening={() => void startCapture()}
              onStopListening={() => void stopCapture()}
              onAtShop={() => void handleToggleAtShop()}
              onStartMove={() => void handleStartMoveBurst()}
              onStopMatch={() => void handleStopMoveBurst()}
              onArmMulti={() => void handleArmMulti()}
              onStopMulti={() => void handleStopMulti()}
            />

            <BurstCaptureControls
              captureUrl={burstCaptureUrl}
              captureDurationMs={burstCaptureMs}
              onPlayCapture={playBurstCapture}
              onDownloadCapture={downloadBurstCapture}
            />

            {activeError && (
              <ActiveSessionError
                entry={activeError}
                onFixInfra={() => openTroubleshooting('windows')}
              />
            )}
            <SessionErrorHistory
              entries={sessionErrors}
              onClear={() => setSessionErrors([])}
              hideActiveBanner
              onFixInfra={() => openTroubleshooting('windows')}
            />

            {shopToast && (
              <div
                role="status"
                className={[
                  'rounded border px-2.5 py-2 text-[11px]',
                  shopToastSticky
                    ? 'border-[var(--warn)] bg-[#2a2208] text-[var(--warn)]'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--muted)]',
                ].join(' ')}
              >
                <div className="flex justify-between gap-2">
                  <p className="m-0 whitespace-pre-wrap">{shopToast}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setShopToast(null);
                      setShopToastSticky(false);
                    }}
                    className="shrink-0 text-[10px] text-[var(--muted)]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {latestLock ? (
              <LatestLockFeed
                soundId={latestLock.soundId}
                audioConfidence={latestLock.confidence}
                items={latestLock.items}
                hideImages={hideImages}
                onlyRed={onlyRed}
                onlyYellow={onlyYellow}
                selectedSizes={selectedSizes}
                onToggleSize={toggleSize}
                onOnlyRed={setOnlyRed}
                onOnlyYellow={setOnlyYellow}
                onShowAll={() => {
                  setOnlyRed(false);
                  setOnlyYellow(false);
                }}
                onThumbsUp={
                  multiMode
                    ? () => {
                        const slot = slots[0];
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
                        setSlots((prev) => prev.filter((s) => s.id !== slot.id));
                      }
                    : () => finishLocked('up')
                }
                onThumbsDown={
                  multiMode
                    ? () => {
                        if (slots[0]) {
                          setMissTarget(slots[0].id);
                          setMissOpen(true);
                        }
                      }
                    : () => {
                        setMissTarget('locked');
                        setMissOpen(true);
                      }
                }
                onSkip={multiMode ? undefined : () => finishLocked('skip')}
                earlier={
                  multiMode
                    ? slots.slice(1).map((s) => ({
                        id: s.id,
                        soundId: s.soundId,
                        confidence: s.confidence,
                        items: s.items,
                      }))
                    : undefined
                }
                onDismissEarlier={(id) => {
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
              />
            ) : (
              <div className="rounded border border-dashed border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted)]">
                {capturing
                  ? multiMode
                    ? 'At Shop → Arm Multi → drag each cargo 3 times. Locks appear here with images and value.'
                    : 'At Shop → Start Moving Item → Stop & Match. Locks appear here with images and value.'
                  : 'Start Listening, then At Shop when you reach the Field Merchant.'}
              </div>
            )}

            <AccuracyPanel
              stats={stats}
              onExport={() => downloadCalibrationJson(sessionId)}
              onClear={() => {
                clearCalibrationEvents();
                setStatsTick((n) => n + 1);
              }}
            />
          </div>
        )}

        {shellScreen === 'manual' && (
          <div className="max-w-[960px] mx-auto flex flex-col gap-4">
            <WipAccuracyBanner />
            <div className="space-y-1">
              <h2 className="m-0 text-2xl font-medium tracking-tight">Manual</h2>
              <p className="m-0 text-sm text-[var(--muted)]">
                Filters + sound board — audition pickup IDs by hand. Not the listen/scan loop.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
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
              <section className="min-w-0 flex flex-col gap-3">
                {(manualSoundId != null || locked) && (
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
                {manualSoundId == null && !locked && (
                  <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
                    Pick a Sound ID from the board. Switch to Auto for Field Merchant listening.
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => openTroubleshooting('overview')}
                  className="self-start bg-transparent border-none text-[var(--accent)] text-xs cursor-pointer p-0"
                >
                  Audio issues? Open Troubleshooting →
                </button>
              </section>
            </div>
          </div>
        )}

        {shellScreen === 'troubleshooting' && (
          <TroubleshootingPage
            section={troubleSection}
            capturing={capturing}
            onSection={setTroubleSection}
            onBack={() => setShellScreen(troubleReturn)}
            onVerify={() => void runVerify()}
            onSelftest={() => {
              setSelftestOpen(true);
              if (!selftestReport && !selftestRunning) void runSelftest();
            }}
            onStartListening={() => void startCapture()}
            onStopListening={() => void stopCapture()}
            onRetest={() => void retestListening()}
            onStartOver={startOver}
            onMicFallback={() => {
              stopVerifySession();
              setSuggestMicFallback(true);
              setVerifyOpen(true);
              setVerifyState({
                phase: 'idle',
                message:
                  'Screen share optional — pick a mic / loopback device below (VB-Cable, Stereo Mix, etc.).',
                rms: 0,
                peakRms: 0,
                hasAudioTrack: false,
              });
            }}
          />
        )}
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

      <footer className="mt-auto border-t border-[var(--border)] px-3 py-2 text-center">
        <span className="text-[11px] tabular-nums text-[var(--muted)]">
          v{__APP_VERSION__}
        </span>
      </footer>
    </div>
  );
}
