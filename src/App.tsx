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
  BurstCaptureControls,
  SessionErrorChip,
  SessionErrorHistory,
  SessionErrorModal,
  type SessionErrorEntry,
} from './components/SessionErrorHistory';
import { MissFeedbackModal } from './components/MissFeedbackModal';
import { AccuracyPanel } from './components/AccuracyPanel';
import { CalibrationDebugPanel } from './components/CalibrationDebugPanel';
import { SelftestPanel } from './components/SelftestPanel';
import { ChromeBar } from './components/ChromeBar';
import { EntryScreen } from './components/EntryScreen';
import { AutoWizard, type AutoSettings } from './components/AutoWizard';
import { StepRow, type WizardStep } from './components/StepRow';
import { ListenCircle } from './components/ListenCircle';
import { LatestLockFeed } from './components/LatestLockFeed';
import { RaidContextBar } from './components/RaidContextBar';
import { RecommendedAudioButton } from './components/RecommendedAudioSettings';
import {
  TroubleshootingPage,
  type TroubleSection,
} from './components/TroubleshootingPage';
import { SuggestionsModal } from './components/SuggestionsModal';
import { StatsPage } from './components/StatsPage';
import { MapModePoolsPage } from './components/MapModePoolsPage';
import type { SingleLoopPhase } from './components/SingleItemLoop';
import {
  analyserFftSize,
  AudioMatcher,
  filterItemsByCargo,
  matchSpectrumAgainstFingerprints,
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
import {
  buildMissReport,
  isCalibrationDebugEnabledFromUrl,
  readCalibrationDebugPref,
  summarizeConfusion,
  writeCalibrationDebugPref,
  type MissReportPayload,
  type RaidContextSnapshot,
} from './utils/confusionDebug';
import {
  postMissReport,
  readCalibrationAutoSavePref,
  writeCalibrationAutoSavePref,
} from './utils/missReportsApi';
import {
  postCommunityEvent,
  postCommunityVote,
  trackCommunityMapMode,
  trackCommunityScan,
  trackCommunityVisit,
} from './utils/communityVotes';
import { alertForMatch } from './utils/soundAlerts';
import { openDocumentPiP, renderPipContent, type PipHandle } from './utils/pipOverlay';
import { type SensitivityLevel } from './utils/sensitivity';
import {
  applyLiveConsensus,
  buildBestGuessPool,
  DEFAULT_TOP_N,
  emptyLiveConsensus,
  type LiveConsensusState,
  type RankedSoundCandidate,
} from './utils/rankedGuess';
import {
  applySizeConstrainedFallback,
  computeEvSummary,
  costBasisForBucket,
  resolveProfileId,
  scoreWithinRaidFilter,
  type CargoPriceBucket,
  type MapModeOption,
  type RaidPoolBox,
  type RaidProfileMeta,
} from './utils/raidPools';

const items = merchantData.items as MerchantItem[];
const fingerprints = fingerprintsData as FingerprintsFile;
const sounds = merchantData.soundIds as SoundProfile[];
const mapModes = ((merchantData as { mapModes?: MapModeOption[] }).mapModes ??
  []) as MapModeOption[];
const raidPools = ((merchantData as { pools?: RaidPoolBox[] }).pools ??
  []) as RaidPoolBox[];
const raidProfiles = ((merchantData as { profiles?: RaidProfileMeta[] }).profiles ??
  []) as RaidProfileMeta[];
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
  /** Equal-share red % within primary group (legacy alerts / accuracy). */
  redPct: number;
  /** Weighted red chance over ranked candidate pool (Phase 2 HUD). */
  redChancePercent: number;
  resultItems: MerchantItem[];
  lowConfidence: boolean;
  rankedCandidates: RankedSoundCandidate[];
  isolatedItem: boolean;
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('automatic');
  const [shellScreen, setShellScreen] = useState<
    | 'entry'
    | 'wizard'
    | 'listen'
    | 'manual'
    | 'troubleshooting'
    | 'stats'
    | 'pools'
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
    'entry' | 'wizard' | 'listen' | 'manual' | 'stats' | 'pools'
  >('entry');
  const [statsReturn, setStatsReturn] = useState<
    'entry' | 'wizard' | 'listen' | 'manual' | 'troubleshooting' | 'pools'
  >('entry');
  const [poolsReturn, setPoolsReturn] = useState<
    'entry' | 'wizard' | 'listen' | 'manual' | 'troubleshooting' | 'stats'
  >('entry');
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [useTts, setUseTts] = useState(true);
  const [size, setSize] = useState('');
  const [cargoType, setCargoType] = useState('');
  const [cargoPrice, setCargoPrice] = useState<number | ''>('');
  /** Catch HUD price pills — coarse buckets (Any / <50k / 100k / 200k / >200k). */
  const [cargoPriceBucket, setCargoPriceBucket] = useState<CargoPriceBucket>('');
  const [mapModeId, setMapModeId] = useState('');
  const [errorModalOpen, setErrorModalOpen] = useState(false);
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
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selftestProgress, setSelftestProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [selftestReport, setSelftestReport] = useState<SelftestReport | null>(null);
  const [singlePhase, setSinglePhase] = useState<SingleLoopPhase>('ready');
  const [locked, setLocked] = useState<LockedScan | null>(null);
  /** Live rolling peek while Start Moving / Multi burst (~450ms). */
  const [livePreview, setLivePreview] = useState<LockedScan | null>(null);
  /**
   * Onset-anchored consensus for live narrowing:
   * sticky within one click + confidence-weighted votes across clean onsets.
   */
  const liveConsensusRef = useRef<LiveConsensusState>(emptyLiveConsensus());
  const [slots, setSlots] = useState<SessionSlot[]>([]);
  const [missOpen, setMissOpen] = useState(false);
  const [missTarget, setMissTarget] = useState<'locked' | string | null>(null);
  const [statsTick, setStatsTick] = useState(0);
  const [floatOverlay, setFloatOverlay] = useState(false);
  const [sessionId] = useState(() => newSessionId());
  /** Progressive disclosure: Calibration / Confusion panel (Advanced + ?debug=1). */
  const [calibrationDebug, setCalibrationDebug] = useState(() =>
    readCalibrationDebugPref(),
  );
  const [calibrationPanelOpen, setCalibrationPanelOpen] = useState(() =>
    isCalibrationDebugEnabledFromUrl() || readCalibrationDebugPref(),
  );
  const [expectedSoundId, setExpectedSoundId] = useState<number | null>(null);
  const [confusionEvents, setConfusionEvents] = useState<MissReportPayload[]>([]);
  const [confusionClips, setConfusionClips] = useState<Record<string, Blob>>({});
  const [calibrationAutoSave, setCalibrationAutoSave] = useState(() =>
    readCalibrationAutoSavePref(),
  );
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>(
    'idle',
  );
  const lastLoggedOnsetRef = useRef<number | null>(null);
  const expectedSoundIdRef = useRef<number | null>(null);
  const calibrationDebugRef = useRef(calibrationDebug);
  const calibrationAutoSaveRef = useRef(calibrationAutoSave);
  /** True when we auto-started Start Moving for calibration logging. */
  const calibrationAutoArmedRef = useRef(false);
  expectedSoundIdRef.current = expectedSoundId;
  calibrationDebugRef.current = calibrationDebug;
  calibrationAutoSaveRef.current = calibrationAutoSave;

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

  const raidProfileId = useMemo(
    () => resolveProfileId({ mapModeId: mapModeId || undefined }, mapModes),
    [mapModeId],
  );

  const filteredManual = useMemo(
    () =>
      filterItemsByCargo(items, {
        size: size || undefined,
        cargoType: cargoType || undefined,
        cargoPrice: cargoPrice === '' ? undefined : cargoPrice,
        profileId: raidProfileId,
      }),
    [size, cargoType, cargoPrice, raidProfileId],
  );

  const selectedSizesRef = useRef(selectedSizes);
  selectedSizesRef.current = selectedSizes;
  const cargoTypeRef = useRef(cargoType);
  cargoTypeRef.current = cargoType;
  const cargoPriceRef = useRef(cargoPrice);
  cargoPriceRef.current = cargoPrice;
  const mapModeIdRef = useRef(mapModeId);
  mapModeIdRef.current = mapModeId;
  const captureSourceRef = useRef(captureSource);
  captureSourceRef.current = captureSource;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const raidSnapshot = useCallback((): RaidContextSnapshot => {
    const id = mapModeIdRef.current || null;
    const label = id
      ? mapModes.find((m) => String(m.id) === String(id))?.name ?? id
      : null;
    const price = cargoPriceRef.current;
    return {
      mapModeId: id,
      mapModeLabel: label,
      cargoType: cargoTypeRef.current || null,
      cargoPrice: price === '' ? null : price,
    };
  }, []);

  const stats = useMemo(() => {
    void statsTick;
    return computeAccuracyStats(listCalibrationEvents());
  }, [statsTick]);

  // Community visit ≈ unique tab session (sessionStorage dedupe).
  useEffect(() => {
    trackCommunityVisit();
  }, []);

  useEffect(() => {
    if (mapModeId) trackCommunityMapMode(mapModeId);
  }, [mapModeId]);

  // Hidden screenshot/demo seed: ?catchDemo=1 jumps to Start Scan with a Group #8 best-guess card.
  // ?missDemo=1 same lock + opens 👎 “what did you actually get?” modal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const catchDemo = params.get('catchDemo') === '1';
    const missDemo = params.get('missDemo') === '1';
    if (!catchDemo && !missDemo) return;
    setMode('automatic');
    setMonitorSetup('single');
    setScanStyle('single');
    setShellScreen('listen');
    setWizardStep('listen');
    const demoIds = [8, 14, 2];
    const matches: MatchResult[] = demoIds.map((soundId, i) => {
      const groupItems = items.filter((it) => it.soundId === soundId);
      return {
        soundId,
        confidence: [98.4, 96.4, 92.2][i] ?? 80,
        kind: 'pickup' as const,
        items: groupItems,
        spectralCentroid: 3200,
      };
    });
    const pool = buildBestGuessPool(matches, items, {
      topN: DEFAULT_TOP_N,
      lowConfidence: true,
    });
    if (!pool) return;
    const top = matches[0];
    setLocked({
      match: {
        ...top,
        soundId: pool.primary.soundId,
        confidence: pool.primary.confidence,
        kind: pool.primary.kind,
        items: pool.primary.items,
      },
      alt: matches,
      spectrumVector: [],
      capturedCentroid: 3200,
      redPct: redLikelihoodPercent(pool.primary.items),
      redChancePercent: pool.redChancePercent,
      resultItems: pool.primary.items,
      lowConfidence: true,
      rankedCandidates: pool.candidates,
      isolatedItem: pool.isolatedItem,
    });
    if (missDemo) {
      setMissTarget('locked');
      setMissOpen(true);
      setSinglePhase('locked');
    }
  }, []);

  // Hidden QA demo: ?verifyErrorDemo=1 — centered verify/share error modal (+ chip after Close).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('verifyErrorDemo') !== '1') return;
    setMode('automatic');
    setMonitorSetup('single');
    setScanStyle('single');
    setShellScreen('listen');
    setWizardStep('listen');
    setStatus('error');
    setStatusDetail('NotAllowedError: Permission denied / share canceled (demo)');
    setSuggestMicFallback(false);
    setVerifyState({
      phase: 'error',
      message: 'Share canceled or denied — demo',
      detail: 'NotAllowedError: Permission denied',
      rms: 0,
      peakRms: 0,
      hasAudioTrack: false,
    });
    setVerifyOpen(true);
  }, []);

  // Hidden QA demo: ?liveStickyDemo=1 — strong #1 then weak #3 decay ticks; consensus holds #1.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('liveStickyDemo') !== '1') return;
    setMode('automatic');
    setMonitorSetup('single');
    setScanStyle('single');
    setShellScreen('listen');
    setWizardStep('listen');
    setCapturing(true);
    setAtShop(true);
    setRecordingMove(true);
    setStatus('listening');
    setStatusDetail('Live consensus demo — strong #1 holds through weak #3 decay ticks');

    // Brent+Gemini hop pattern: nail #1 @91–97%, then ~500ms later #3 @~75% (same click tail).
    // Also include same-onset mid-pack thrash. Consensus must keep Group #1.
    const frames: { ids: number[]; confs: number[]; onsetMs: number }[] = [
      { ids: [1, 28, 3], confs: [93.3, 78, 71], onsetMs: 1000 },
      { ids: [1, 28, 3], confs: [95.1, 76, 70], onsetMs: 1020 }, // same onset fill-in
      { ids: [3, 1, 28], confs: [75.4, 72, 68], onsetMs: 1520 }, // decay lobe — ignore
      { ids: [3, 2, 1], confs: [77.8, 74, 70], onsetMs: 1980 }, // another weak — ignore
      { ids: [1, 28, 3], confs: [93.6, 80, 72], onsetMs: 2500 }, // reinforce #1
      { ids: [28, 1, 3], confs: [78, 75, 70], onsetMs: 2520 }, // same-onset thrash
      { ids: [3, 20, 1], confs: [74, 73, 72], onsetMs: 2540 },
      { ids: [1, 28, 3], confs: [92, 78, 71], onsetMs: 2560 },
    ];
    let i = 0;
    let consensus = emptyLiveConsensus();
    const apply = () => {
      const frame = frames[i % frames.length];
      i += 1;
      const matches: MatchResult[] = frame.ids.map((soundId, idx) => ({
        soundId,
        confidence: frame.confs[idx] ?? 70,
        kind: 'pickup' as const,
        items: items.filter((it) => it.soundId === soundId),
        spectralCentroid: 3200,
      }));
      consensus = applyLiveConsensus(consensus, {
        matches,
        onsetMs: frame.onsetMs,
      });
      const sized = consensus.matches;
      if (!sized.length || consensus.soundId == null) return;
      const pool = buildBestGuessPool(sized, items, {
        topN: DEFAULT_TOP_N,
        lowConfidence: true,
      });
      if (!pool) return;
      const top = sized[0];
      const resultItems = pool.primary.items;
      setLivePreview({
        match: {
          ...top,
          soundId: pool.primary.soundId,
          confidence: pool.primary.confidence,
          kind: pool.primary.kind,
          items: resultItems,
        },
        alt: sized.slice(0, DEFAULT_TOP_N),
        spectrumVector: [],
        capturedCentroid: 3200,
        redPct: redLikelihoodPercent(resultItems),
        redChancePercent: pool.redChancePercent,
        resultItems,
        lowConfidence: true,
        rankedCandidates: pool.candidates,
        isolatedItem: pool.isolatedItem,
      });
    };
    apply();
    const id = window.setInterval(apply, 450);
    return () => window.clearInterval(id);
  }, []);

  // Open error modal when a new setup/session error arrives (chip re-opens later).
  useEffect(() => {
    if ((status === 'error' || suggestMicFallback) && !verifyOpen) {
      setErrorModalOpen(true);
    }
  }, [status, statusDetail, suggestMicFallback, verifyOpen]);

  useEffect(() => {
    if (sessionErrors.length > 0 && status !== 'error') {
      setErrorModalOpen(true);
    }
    // Only when a new top error id appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionErrors[0]?.id]);

  // Live rolling match while burst is recording — freeze on silence / no onset.
  // Onset-anchored peek + confidence-weighted consensus across clean onsets.
  useEffect(() => {
    if (!recordingMove) {
      liveConsensusRef.current = emptyLiveConsensus();
      lastLoggedOnsetRef.current = null;
      return;
    }
    const LIVE_MS = 450;
    const tick = () => {
      const matcher = matcherRef.current;
      if (!matcher?.isBurstRecording()) return;
      const peek = matcher.peekBurstMatches();
      // No rising-edge / past window → freeze last solid consensus (do not invent).
      if (!peek || peek.matches.length === 0) {
        liveConsensusRef.current = applyLiveConsensus(
          liveConsensusRef.current,
          null,
        );
        return;
      }

      // Calibration / Confusion: log each new clean onset when ground-truth is set.
      const expectedId = expectedSoundIdRef.current;
      if (
        calibrationDebugRef.current &&
        expectedId != null &&
        lastLoggedOnsetRef.current !== peek.onsetMs
      ) {
        lastLoggedOnsetRef.current = peek.onsetMs;
        const ranked =
          peek.allMatches.length > 0
            ? peek.allMatches
            : matchSpectrumAgainstFingerprints(
                peek.spectrumVector,
                fingerprints,
                ALL_SOUND_IDS,
                'pickup',
                peek.capturedCentroid,
              );
        let clipId: string | undefined;
        const wav = matcher.extractBurstOnsetWav(peek.onsetMs);
        if (wav) {
          clipId = `onset-${peek.onsetMs}-${Date.now().toString(36)}`;
          setConfusionClips((prev) => ({ ...prev, [clipId!]: wav }));
        }
        const event = buildMissReport({
          expectedId,
          matches: ranked,
          source: 'live-onset',
          fingerprints,
          spectrumVector: peek.spectrumVector,
          capturedCentroid: peek.capturedCentroid,
          onsetDurationMs: peek.onsetDurationMs,
          peakRms: peek.peakRms,
          meanRms: peek.meanRms,
          noiseFloor: peek.noiseFloor,
          rmsBaseline: peek.rmsBaseline,
          sampleRate: peek.sampleRate,
          captureMode: peek.captureMode,
          sessionId,
          appVersion: __APP_VERSION__,
          raid: raidSnapshot(),
          clipId,
        });
        setConfusionEvents((prev) => [...prev, event].slice(-200));
        if (calibrationAutoSaveRef.current) {
          setAutoSaveStatus('saving');
          void postMissReport(event).then((ok) => {
            setAutoSaveStatus(ok ? 'ok' : 'err');
          });
        }
      }

      const sizedRaw = applySizeConstrainedFallback(
        peek.matches,
        items,
        selectedSizesRef.current,
      );
      const next = applyLiveConsensus(liveConsensusRef.current, {
        matches: sizedRaw,
        onsetMs: peek.onsetMs,
      });
      liveConsensusRef.current = next;
      const sized = next.matches;
      if (!sized.length || next.soundId == null) return;
      const pool = buildBestGuessPool(sized, items, {
        topN: DEFAULT_TOP_N,
        lowConfidence: true,
      });
      if (!pool) return;
      const top = sized[0];
      const resultItems = pool.primary.items;
      setLivePreview({
        match: {
          ...top,
          soundId: pool.primary.soundId,
          confidence: pool.primary.confidence,
          kind: pool.primary.kind,
          items: resultItems,
        },
        alt: sized.slice(0, DEFAULT_TOP_N),
        spectrumVector: top.spectrumVector ?? [],
        capturedCentroid: top.capturedCentroid ?? 0,
        redPct: redLikelihoodPercent(resultItems),
        redChancePercent: pool.redChancePercent,
        resultItems,
        lowConfidence: true,
        rankedCandidates: pool.candidates,
        isolatedItem: pool.isolatedItem,
      });
    };
    tick();
    const id = window.setInterval(tick, LIVE_MS);
    return () => window.clearInterval(id);
  }, [recordingMove, raidSnapshot, sessionId]);

  /**
   * Advanced calibration: when Actual Sound ID is set while capturing, auto-arm
   * Start Moving so clean onsets actually feed the logger (plain Listen alone
   * used to show “logging” with gray Copy and zero rows). Skip while a lock is
   * on screen so Report issue / Download WAV stay undisturbed.
   */
  useEffect(() => {
    const multi =
      scanStyleRef.current === 'continuous' && monitorRef.current === 'dual';
    if (
      !calibrationDebug ||
      expectedSoundId == null ||
      !capturing ||
      recordingMove ||
      multi ||
      multiArmed ||
      (locked != null && singlePhase === 'locked')
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!matcherRef.current) return;
      try {
        setShopCalibrating(!atShop);
        await matcherRef.current.startItemMoveBurst();
        if (cancelled) {
          await matcherRef.current.stopItemMoveBurst().catch(() => undefined);
          return;
        }
        calibrationAutoArmedRef.current = true;
        setAtShop(true);
        setRecordingMove(true);
        setLivePreview(null);
        setShopToast(
          `Calibration logging Actual #${expectedSoundId} — click cargo; Copy Debug JSON anytime.`,
        );
        setShopToastSticky(false);
      } catch (err) {
        calibrationAutoArmedRef.current = false;
        const msg = err instanceof Error ? err.message : String(err);
        setShopToast(`Calibration arm failed: ${msg}`);
      } finally {
        if (!cancelled) setShopCalibrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally omit atShop — startItemMoveBurst calibrates if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    calibrationDebug,
    expectedSoundId,
    capturing,
    recordingMove,
    multiArmed,
    locked,
    singlePhase,
  ]);

  /** Drop auto-armed burst when Actual ID cleared (leave manual Start Moving alone). */
  useEffect(() => {
    if (expectedSoundId != null) return;
    if (!calibrationAutoArmedRef.current) return;
    calibrationAutoArmedRef.current = false;
    if (!recordingMove || !matcherRef.current) return;
    void matcherRef.current.stopMultiContinuous({ match: false }).catch(() => undefined);
    setRecordingMove(false);
    setLivePreview(null);
  }, [expectedSoundId, recordingMove]);

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
      // Global tallies are best-effort; localStorage already recorded above.
      if (opts.feedback === 'up' || opts.feedback === 'down') {
        postCommunityVote(opts.predicted.soundId, opts.feedback);
      }
      setStatsTick((n) => n + 1);
    },
    [mode, sessionId],
  );

  const updatePip = useCallback(
    (data: {
      group: number;
      confidence: number;
      redPct: number;
      status: string;
      expectedValue?: number | null;
      paybackPercent?: number | null;
    }) => {
      if (pipRef.current?.window && !pipRef.current.window.closed) {
        renderPipContent(pipRef.current.window, data);
      }
    },
    [],
  );

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

  /** Phase 2: always surface top-N best guess from existing scores (never blank). */
  const applyBestGuess = useCallback(
    (
      matches: MatchResult[],
      opts: {
        lowConfidence: boolean;
        spectrumVector?: number[];
        capturedCentroid?: number;
        captureBlob?: Blob | null;
        captureDurationMs?: number;
        statusLabel?: string;
        toastMsg?: string | null;
        pushError?: boolean;
      },
    ) => {
      const sized = applySizeConstrainedFallback(
        matches,
        items,
        selectedSizesRef.current,
      );
      const pool = buildBestGuessPool(sized, items, {
        topN: DEFAULT_TOP_N,
        lowConfidence: opts.lowConfidence,
      });
      if (!pool) {
        const msg = 'Match produced no candidates — try Stop & Match again.';
        setShopToast(msg);
        pushSessionError(msg);
        return null;
      }
      const top = sized[0];
      const resultItems = pool.primary.items;
      const redPct = redLikelihoodPercent(resultItems);
      const scored = scoreWithinRaidFilter(
        resultItems,
        {
          mapModeId: mapModeIdRef.current || undefined,
          sizes: selectedSizesRef.current,
          cargoType: cargoTypeRef.current || undefined,
          cargoPrice: cargoPriceRef.current,
        },
        mapModes,
      );
      const ev = computeEvSummary(scored, cargoPriceRef.current);
      const lockedScan: LockedScan = {
        match: {
          ...top,
          soundId: pool.primary.soundId,
          confidence: pool.primary.confidence,
          kind: pool.primary.kind,
          items: resultItems,
        },
        alt: sized.slice(0, DEFAULT_TOP_N),
        spectrumVector: opts.spectrumVector ?? top.spectrumVector ?? [],
        capturedCentroid: opts.capturedCentroid ?? top.capturedCentroid ?? 0,
        redPct,
        redChancePercent: pool.redChancePercent,
        resultItems,
        lowConfidence: pool.lowConfidence,
        rankedCandidates: pool.candidates,
        isolatedItem: pool.isolatedItem,
      };

      if (opts.captureBlob) {
        adoptBurstCapture(opts.captureBlob, opts.captureDurationMs ?? 0);
      }
      if (opts.toastMsg) {
        setShopToast(opts.toastMsg);
        if (opts.pushError) pushSessionError(opts.toastMsg);
      } else if (!opts.lowConfidence) {
        setShopToast(null);
        setShopToastSticky(false);
      }

      void alertForMatch({
        soundId: pool.primary.soundId,
        redPct: pool.redChancePercent,
        enabled: monitorRef.current === 'single' && soundAlerts && !opts.lowConfidence,
        useTts: useTts,
      });

      updatePip({
        group: pool.primary.soundId,
        confidence: pool.primary.confidence,
        redPct: pool.redChancePercent,
        status: opts.statusLabel ?? (opts.lowConfidence ? 'Best guess' : 'Match locked'),
        expectedValue: ev.expectedValue,
        paybackPercent: ev.paybackPercent,
      });

      return { pool, lockedScan };
    },
    [pushSessionError, soundAlerts, updatePip, useTts],
  );

  const commitBestGuess = useCallback(
    (
      matches: MatchResult[],
      meta: {
        lowConfidence: boolean;
        spectrumVector?: number[];
        capturedCentroid?: number;
        captureBlob?: Blob | null;
        captureDurationMs?: number;
        toastMsg?: string | null;
        pushError?: boolean;
        statusLabel?: string;
      },
    ) => {
      const applied = applyBestGuess(matches, meta);
      if (!applied) return;
      const { lockedScan, pool } = applied;
      setLivePreview(null);

      trackCommunityScan({
        soundId: lockedScan.match.soundId,
        mode: modeRef.current,
        captureSource: captureSourceRef.current,
        redChancePercent: pool.redChancePercent,
      });

      // Multi keeps recordingMove true (re-arms after cooldown); single stops.
      if (!(scanStyleRef.current === 'continuous' && monitorRef.current === 'dual')) {
        setRecordingMove(false);
      }

      if (mode === 'manual') {
        setManualSoundId(lockedScan.match.soundId);
        setLocked(lockedScan);
        return;
      }

      if (scanStyleRef.current === 'continuous' && monitorRef.current === 'dual') {
        matcherRef.current?.setListeningPaused(false);
        setSlots((prev) =>
          [
            buildSlotFromMatch(lockedScan.match, items, {
              lowConfidence: pool.lowConfidence,
              redChancePercent: pool.redChancePercent,
              rankedCandidates: pool.candidates,
              isolatedItem: pool.isolatedItem,
            }),
            ...prev,
          ].slice(0, 48),
        );
        return;
      }

      // Style A — show result (firm lock or low-confidence best guess)
      matcherRef.current?.setListeningPaused(true);
      setSinglePhase('locked');
      setLocked(lockedScan);
    },
    [applyBestGuess, mode],
  );

  /**
   * Upload numbers-only MissReportPayload (never spectrum / WAV).
   * Player 👎 always posts; calibration onsets only when Auto-save is on.
   */
  const uploadMissReport = useCallback((event: MissReportPayload, force: boolean) => {
    if (!force && !calibrationAutoSaveRef.current) return;
    setAutoSaveStatus('saving');
    void postMissReport(event).then((ok) => {
      setAutoSaveStatus(ok ? 'ok' : 'err');
    });
  }, []);

  const logConfusionFromPayload = useCallback(
    (payload: MatchPayload) => {
      const expectedId = expectedSoundIdRef.current;
      if (!calibrationDebugRef.current || expectedId == null) return;
      if (!payload.spectrumVector?.length) return;
      const ranked =
        payload.allMatches && payload.allMatches.length > 0
          ? payload.allMatches
          : matchSpectrumAgainstFingerprints(
              payload.spectrumVector,
              fingerprints,
              ALL_SOUND_IDS,
              'pickup',
              payload.capturedCentroid,
            );
      let clipId: string | undefined;
      if (payload.captureBlob) {
        clipId = `burst-${Date.now().toString(36)}`;
        setConfusionClips((prev) => ({ ...prev, [clipId!]: payload.captureBlob! }));
      }
      const diag = payload.diagnostics;
      const event = buildMissReport({
        expectedId,
        matches: ranked,
        source: payload.source === 'auto' ? 'auto' : 'burst',
        fingerprints,
        spectrumVector: payload.spectrumVector,
        capturedCentroid: payload.capturedCentroid,
        onsetDurationMs: diag?.onsetDurationMs ?? 300,
        peakRms: diag?.peakRms ?? 0,
        meanRms: diag?.meanRms ?? diag?.peakRms ?? 0,
        noiseFloor: diag?.noiseFloor ?? matcherRef.current?.getNoiseFloor() ?? 0,
        rmsBaseline: diag?.rmsBaseline ?? matcherRef.current?.getRmsBaseline() ?? 0,
        sampleRate: diag?.sampleRate ?? matcherRef.current?.getSampleRate() ?? 0,
        captureMode: diag?.captureMode ?? matcherRef.current?.getCaptureSource() ?? null,
        sessionId,
        appVersion: __APP_VERSION__,
        raid: raidSnapshot(),
        clipId,
      });
      setConfusionEvents((prev) => [...prev, event].slice(-200));
      uploadMissReport(event, false);
    },
    [raidSnapshot, sessionId, uploadMissReport],
  );

  /** Player 👎 → same MissReportPayload as Calibration logger (local WAV, numbers-only JSON). */
  const logPlayerMissReport = useCallback(
    (opts: {
      predictedId: number;
      expectedId: number;
      spectrumVector?: number[];
      capturedCentroid?: number;
      actualItemId?: number;
      actualItemName?: string;
      allMatches?: MatchResult[];
    }) => {
      const spectrum = opts.spectrumVector ?? [];
      const centroid = opts.capturedCentroid ?? 0;
      const ranked =
        opts.allMatches && opts.allMatches.length > 0
          ? opts.allMatches
          : spectrum.length > 0
            ? matchSpectrumAgainstFingerprints(
                spectrum,
                fingerprints,
                ALL_SOUND_IDS,
                'pickup',
                centroid,
              )
            : [
                {
                  soundId: opts.predictedId,
                  confidence: 0,
                  kind: 'pickup' as const,
                  items: [],
                  spectralCentroid: centroid,
                },
              ];
      let clipId: string | undefined;
      const blob = burstCaptureBlobRef.current;
      if (blob) {
        clipId = `player-miss-${Date.now().toString(36)}`;
        setConfusionClips((prev) => ({ ...prev, [clipId!]: blob }));
      }
      const matcher = matcherRef.current;
      const event = buildMissReport({
        expectedId: opts.expectedId,
        matches: ranked,
        source: 'player-miss',
        fingerprints,
        spectrumVector: spectrum,
        capturedCentroid: centroid,
        onsetDurationMs: 300,
        peakRms: 0,
        meanRms: 0,
        noiseFloor: matcher?.getNoiseFloor() ?? 0,
        rmsBaseline: matcher?.getRmsBaseline() ?? 0,
        sampleRate: matcher?.getSampleRate() ?? 0,
        captureMode: matcher?.getCaptureSource() ?? captureSourceRef.current,
        sessionId,
        appVersion: __APP_VERSION__,
        raid: raidSnapshot(),
        actualItemId: opts.actualItemId,
        actualItemName: opts.actualItemName,
        predictedIdOverride: opts.predictedId,
        clipId,
      });
      setConfusionEvents((prev) => [...prev, event].slice(-200));
      // Always POST numbers-only diagnostics for community confusion stats.
      uploadMissReport(event, true);
      // Surface panel so player can Copy JSON / Download Clip WAV (local).
      setCalibrationDebug(true);
      writeCalibrationDebugPref(true);
      setCalibrationPanelOpen(true);
    },
    [raidSnapshot, sessionId, uploadMissReport],
  );

  const handleMatchPayload = useCallback(
    (payload: MatchPayload) => {
      logConfusionFromPayload(payload);
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
      const lowConfidence = top.confidence < floor;
      if (lowConfidence) {
        const msg = `${isBurst ? 'Stop & Match' : 'Auto'}: weak match Group #${top.soundId} at ${top.confidence}% (need ≥${floor}%) — showing best guess.`;
        setStatus('listening');
        setStatusDetail(msg);
        commitBestGuess(payload.matches, {
          lowConfidence: true,
          spectrumVector: payload.spectrumVector,
          capturedCentroid: payload.capturedCentroid,
          captureBlob: payload.captureBlob,
          captureDurationMs: payload.captureDurationMs,
          toastMsg: msg,
          pushError: true,
          statusLabel: 'Best guess (low confidence)',
        });
        return;
      }
      commitBestGuess(payload.matches, {
        lowConfidence: false,
        spectrumVector: payload.spectrumVector,
        capturedCentroid: payload.capturedCentroid,
        captureBlob: payload.captureBlob,
        captureDurationMs: payload.captureDurationMs,
        statusLabel: 'Match locked',
      });
    },
    [commitBestGuess, logConfusionFromPayload, pushSessionError],
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
        const demoPool = buildBestGuessPool([match], items, { lowConfidence: false });
        setLocked({
          match,
          alt: [match],
          spectrumVector: match.spectrumVector!,
          capturedCentroid: 2800,
          redPct,
          redChancePercent: demoPool?.redChancePercent ?? redPct,
          resultItems,
          lowConfidence: false,
          rankedCandidates: demoPool?.candidates ?? [],
          isolatedItem: demoPool?.isolatedItem ?? resultItems.length === 1,
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
    if (demo === 'pools') {
      setShellScreen('pools');
      return;
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

  // Soft size prior: demote soundIds with no items in checked sizes when conf soft.
  useEffect(() => {
    if (!matcherRef.current) return;
    if (selectedSizes.length === 0) {
      matcherRef.current.setSizePriorSoundIds(null);
      return;
    }
    const ids = [
      ...new Set(
        items.filter((i) => selectedSizes.includes(i.size)).map((i) => i.soundId),
      ),
    ];
    matcherRef.current.setSizePriorSoundIds(ids);
  }, [selectedSizes]);

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
    if (feedback === 'down' && actual?.soundId != null) {
      logPlayerMissReport({
        predictedId: locked.match.soundId,
        expectedId: actual.soundId,
        spectrumVector: locked.spectrumVector,
        capturedCentroid: locked.capturedCentroid,
        actualItemId: actual.itemId,
        actualItemName: actual.itemName,
        allMatches: [locked.match, ...locked.alt],
      });
    }
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

  /** Circle Stop: pause analysis; keep the shared capture device. */
  function pauseListeningKeepCapture() {
    matcherRef.current?.pauseCaptureKeepStream();
    setLivePreview(null);
    setCapturing(false);
    setAtShop(false);
    setRecordingMove(false);
    setShopCalibrating(false);
    setMultiArmed(false);
    setShopToast(null);
    setSinglePhase('ready');
    setStatus('idle');
    setStatusDetail('Paused — capture held. Start Listening to resume (same device).');
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

    // Reuse held capture — do not force re-picking the device.
    if (matcherRef.current?.hasActiveCapture()) {
      prepareMatcherSession();
      const ok = matcherRef.current.resumeCaptureSession();
      if (ok) {
        setCapturing(true);
        setCaptureSource(matcherRef.current.getCaptureSource());
        setStatus('listening');
        setStatusDetail(undefined);
        return;
      }
    }

    try {
      prepareMatcherSession();
      await matcherRef.current?.startCapture();
      setCapturing(true);
      const src = matcherRef.current?.getCaptureSource() ?? 'display';
      setCaptureSource(src);
      postCommunityEvent(src === 'microphone' ? 'capture_mic' : 'capture_display');
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
      postCommunityEvent('capture_mic');
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
    setLivePreview(null);
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
      setLivePreview(null);
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
        // Phase 2: failed lock still shows ranked best guess when scores exist.
        if (result.matches.length > 0) {
          commitBestGuess(result.matches, {
            lowConfidence: true,
            spectrumVector: result.matches[0]?.spectrumVector,
            capturedCentroid: result.matches[0]?.capturedCentroid,
            captureBlob: result.captureBlob,
            captureDurationMs: result.captureDurationMs,
            toastMsg: `${result.reason} — showing best guess.`,
            pushError: false,
            statusLabel: 'Best guess (below lock)',
          });
        }
      } else {
        setShopToastSticky(false);
        // Firm lock already applied via onMatch → handleMatchPayload.
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
      setLivePreview(null);
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
      postCommunityEvent('pip_opens');
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
    calibrationDebug,
  };

  const confusionSummary = useMemo(
    () => summarizeConfusion(confusionEvents),
    [confusionEvents],
  );

  function setCalibrationDebugPref(on: boolean) {
    setCalibrationDebug(on);
    writeCalibrationDebugPref(on);
    if (on) setCalibrationPanelOpen(true);
  }

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
          shellScreen === 'manual' ||
          shellScreen === 'stats' ||
          shellScreen === 'pools'
          ? shellScreen
          : 'entry',
      );
    }
    setTroubleSection(section);
    setShellScreen('troubleshooting');
  }

  function openStats() {
    if (shellScreen !== 'stats') {
      setStatsReturn(
        shellScreen === 'entry' ||
          shellScreen === 'wizard' ||
          shellScreen === 'listen' ||
          shellScreen === 'manual' ||
          shellScreen === 'troubleshooting' ||
          shellScreen === 'pools'
          ? shellScreen
          : 'entry',
      );
    }
    setShellScreen('stats');
  }

  function openPools() {
    if (shellScreen !== 'pools') {
      setPoolsReturn(
        shellScreen === 'entry' ||
          shellScreen === 'wizard' ||
          shellScreen === 'listen' ||
          shellScreen === 'manual' ||
          shellScreen === 'troubleshooting' ||
          shellScreen === 'stats'
          ? shellScreen
          : 'entry',
      );
    }
    setShellScreen('pools');
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

  const firmLock =
    multiMode && slots[0]
      ? {
          soundId: slots[0].soundId,
          confidence: slots[0].confidence,
          items: slots[0].items,
          lowConfidence: slots[0].lowConfidence === true,
          redChancePercent: slots[0].redChancePercent,
          rankedCandidates: slots[0].rankedCandidates,
          isolatedItem: slots[0].isolatedItem === true,
          livePreview: false as boolean,
        }
      : locked
        ? {
            soundId: locked.match.soundId,
            confidence: locked.match.confidence,
            items: locked.resultItems,
            lowConfidence: locked.lowConfidence,
            redChancePercent: locked.redChancePercent,
            rankedCandidates: locked.rankedCandidates,
            isolatedItem: locked.isolatedItem,
            livePreview: false as boolean,
          }
        : null;

  const latestLock =
    firmLock ??
    (livePreview
      ? {
          soundId: livePreview.match.soundId,
          confidence: livePreview.match.confidence,
          items: livePreview.resultItems,
          lowConfidence: true,
          redChancePercent: livePreview.redChancePercent,
          rankedCandidates: livePreview.rankedCandidates,
          isolatedItem: livePreview.isolatedItem,
          livePreview: true,
        }
      : null);

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
      : shellScreen === 'stats'
        ? 'stats'
        : shellScreen === 'pools'
          ? 'pools'
          : shellScreen === 'manual'
            ? 'manual'
            : shellScreen === 'listen'
              ? 'listen'
              : shellScreen === 'wizard'
                ? 'wizard'
                : 'entry';
  const showChrome =
    (shellScreen !== 'entry' &&
      shellScreen !== 'stats' &&
      shellScreen !== 'pools') ||
    hasAudioError;

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
          onStopListening={() => void stopCapture()}
          onRetest={() => void retestListening()}
          onOpenSuggestions={() => setSuggestionsOpen(true)}
          onOpenStats={openStats}
        />
      )}

      <SuggestionsModal open={suggestionsOpen} onClose={() => setSuggestionsOpen(false)} />

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
          // Dismiss modal only — keep status so the yellow reopen chip remains.
          setVerifyOpen(false);
        }}
        onClear={() => {
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
            onOpenSuggestions={() => setSuggestionsOpen(true)}
            onOpenStats={openStats}
            onOpenPools={openPools}
          />
        )}

        {shellScreen === 'stats' && (
          <StatsPage
            stats={stats}
            onBack={() => setShellScreen(statsReturn)}
            onExport={() => downloadCalibrationJson(sessionId)}
            onClear={() => {
              clearCalibrationEvents();
              setStatsTick((n) => n + 1);
            }}
            onOpenSuggestions={() => setSuggestionsOpen(true)}
          />
        )}

        {shellScreen === 'pools' && (
          <MapModePoolsPage
            mapModes={mapModes}
            pools={raidPools}
            profiles={raidProfiles}
            items={items}
            onBack={() => setShellScreen(poolsReturn)}
            onUseInScan={(id) => {
              setMapModeId(id);
              if (monitorSetup) {
                setMode('automatic');
                setShellScreen('listen');
                setWizardStep('listen');
              } else {
                chooseAutomatic();
              }
            }}
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
              if (patch.calibrationDebug != null) {
                setCalibrationDebugPref(patch.calibrationDebug);
              }
            }}
            onNext={goNextFromSettings}
          />
        )}

        {shellScreen === 'listen' && (
          <div className="max-w-[820px] mx-auto flex flex-col gap-3.5" data-catch-hud="v2">
            <StepRow
              step="listen"
              onJump={jumpWizard}
              onBack={stepBack}
              backLabel="← Settings"
            />

            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-xl font-medium tracking-tight">Start Scan</h2>
              <span
                className={[
                  'rounded-full px-2.5 py-0.5 text-[11px] font-semibold border',
                  capturing
                    ? 'border-[var(--listening)]/50 text-[var(--text)] bg-[var(--listening)]/20'
                    : captureSource
                      ? 'border-[var(--accent)]/40 text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--muted)]',
                ].join(' ')}
              >
                {capturing ? 'Live' : captureSource ? 'Paused' : 'Stopped'}
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

            {/* Circle stays put — results move below, never push the circle down */}
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
              liveNarrowing={!!livePreview && recordingMove}
              onStartListening={() => void startCapture()}
              onStopListening={() => pauseListeningKeepCapture()}
              onAtShop={() => void handleToggleAtShop()}
              onStartMove={() => void handleStartMoveBurst()}
              onStopMatch={() => void handleStopMoveBurst()}
              onArmMulti={() => void handleArmMulti()}
              onStopMulti={() => void handleStopMulti()}
            />

            <RecommendedAudioButton />

            <BurstCaptureControls
              captureUrl={burstCaptureUrl}
              captureDurationMs={burstCaptureMs}
              onPlayCapture={playBurstCapture}
              onDownloadCapture={downloadBurstCapture}
              showReportIssue={!!latestLock && !latestLock.livePreview}
              onReportIssue={() => {
                if (multiMode) {
                  if (slots[0]) {
                    setMissTarget(slots[0].id);
                    setMissOpen(true);
                  }
                  return;
                }
                if (!locked) return;
                setMissTarget('locked');
                setMissOpen(true);
              }}
            />

            {((status === 'error' || suggestMicFallback) && !verifyOpen) || activeError ? (
              <SessionErrorChip
                label={
                  status === 'error' || suggestMicFallback
                    ? 'Audio setup error — tap to view'
                    : 'Session error — tap to view'
                }
                onOpen={() => setErrorModalOpen(true)}
              />
            ) : null}

            <SessionErrorModal
              open={errorModalOpen}
              entry={activeError}
              setupDetail={
                (status === 'error' || suggestMicFallback) && !verifyOpen
                  ? statusDetail
                  : null
              }
              suggestMicFallback={suggestMicFallback}
              onClose={() => setErrorModalOpen(false)}
              onFixInfra={() => openTroubleshooting('windows')}
              onRetest={() => void retestListening()}
              onClear={() => {
                clearAudioErrorState();
                setSessionErrors([]);
              }}
              onStartOver={startOver}
            />
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

            {/* Suggested item / result card below the circle */}
            {latestLock ? (
              <LatestLockFeed
                soundId={latestLock.soundId}
                audioConfidence={latestLock.confidence}
                items={latestLock.items}
                hideImages={hideImages}
                onlyRed={onlyRed}
                onlyYellow={onlyYellow}
                selectedSizes={selectedSizes}
                mapModes={mapModes}
                mapModeId={mapModeId}
                cargoType={cargoType}
                cargoPrice={cargoPrice}
                cargoPriceBucket={cargoPriceBucket}
                cargoPrices={merchantData.cargoPrices}
                livePreview={latestLock.livePreview}
                onToggleSize={toggleSize}
                onOnlyRed={setOnlyRed}
                onOnlyYellow={setOnlyYellow}
                onShowAll={() => {
                  setOnlyRed(false);
                  setOnlyYellow(false);
                }}
                onCargoPriceBucket={(b) => {
                  setCargoPriceBucket(b);
                  setCargoPrice(costBasisForBucket(b));
                }}
                lowConfidence={latestLock.lowConfidence}
                redChancePercent={latestLock.redChancePercent}
                rankedCandidates={latestLock.rankedCandidates}
                isolatedItem={latestLock.isolatedItem}
                onPickRanked={(soundId) => {
                  setManualSoundId(soundId);
                  if (locked) {
                    const pick = locked.alt.find((m) => m.soundId === soundId);
                    if (!pick) return;
                    commitBestGuess(
                      [
                        pick,
                        ...locked.alt.filter((m) => m.soundId !== soundId),
                      ],
                      {
                        lowConfidence: locked.lowConfidence,
                        spectrumVector: locked.spectrumVector,
                        capturedCentroid: locked.capturedCentroid,
                        statusLabel: locked.lowConfidence
                          ? 'Best guess (picked alt)'
                          : 'Match locked (picked alt)',
                      },
                    );
                  }
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
                          redPct: slot.redChancePercent ?? slot.redPct,
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
                        lowConfidence: s.lowConfidence,
                        redChancePercent: s.redChancePercent,
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
                      redPct: slot.redChancePercent ?? slot.redPct,
                      feedback: 'dismiss',
                    });
                  }
                  setSlots((prev) => prev.filter((s) => s.id !== id));
                }}
              />
            ) : (
              <div className="rounded border border-dashed border-[var(--border)] px-4 py-5 text-center text-xs text-[var(--muted)]">
                {capturing
                  ? multiMode
                    ? 'At Shop → Arm Multi → drag cargo 3×. Live results appear below the circle.'
                    : 'At Shop → Start Moving Item. Live narrowing updates below (sticky Group ID).'
                  : 'Start Listening at the Field Merchant shop, then At Shop when ready.'}
              </div>
            )}

            {/* Map/Mode for EV/red — not sticky; sits below live chrome so it never clips Match Confidence */}
            <RaidContextBar
              mapModeOnly
              mapModes={mapModes}
              cargoTypes={merchantData.cargoTypes}
              cargoPrices={merchantData.cargoPrices}
              mapModeId={mapModeId}
              cargoType={cargoType}
              cargoPrice={cargoPrice}
              onOpenPools={openPools}
              onChange={(patch) => {
                if (patch.mapModeId !== undefined) setMapModeId(patch.mapModeId);
                if (patch.cargoType !== undefined) setCargoType(patch.cargoType);
                if (patch.cargoPrice !== undefined) setCargoPrice(patch.cargoPrice);
              }}
            />

            {calibrationDebug && (
              <CalibrationDebugPanel
                open={calibrationPanelOpen}
                onOpenChange={setCalibrationPanelOpen}
                soundIds={ALL_SOUND_IDS}
                expectedId={expectedSoundId}
                onExpectedId={setExpectedSoundId}
                events={confusionEvents}
                summary={confusionSummary}
                sessionId={sessionId}
                fingerprints={fingerprints}
                listening={recordingMove || status === 'listening' || status === 'capturing'}
                loggingActive={recordingMove}
                clipBlobs={confusionClips}
                autoSave={calibrationAutoSave}
                autoSaveStatus={autoSaveStatus}
                onAutoSaveChange={(on) => {
                  setCalibrationAutoSave(on);
                  writeCalibrationAutoSavePref(on);
                  setAutoSaveStatus('idle');
                }}
                onClear={() => {
                  setConfusionEvents([]);
                  setConfusionClips({});
                  lastLoggedOnsetRef.current = null;
                }}
              />
            )}

            {!calibrationDebug && (
              <button
                type="button"
                onClick={() => setCalibrationDebugPref(true)}
                className="self-start text-[11px] text-[var(--muted)] underline-offset-2 hover:underline hover:text-[var(--accent)]"
              >
                Advanced · live onset log
              </button>
            )}

            <AccuracyPanel
              collapsedBar
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
            <div className="space-y-1">
              <h2 className="m-0 text-2xl font-medium tracking-tight">Manual Setup</h2>
              <p className="m-0 text-sm text-[var(--muted)]">
                Filters + sound board — audition pickup IDs by hand. For live raids use Start Scan
                (Automatic).
              </p>
            </div>
            <RaidContextBar
              mapModes={mapModes}
              cargoTypes={merchantData.cargoTypes}
              cargoPrices={merchantData.cargoPrices}
              mapModeId={mapModeId}
              cargoType={cargoType}
              cargoPrice={cargoPrice}
              onOpenPools={openPools}
              onChange={(patch) => {
                if (patch.mapModeId !== undefined) setMapModeId(patch.mapModeId);
                if (patch.cargoType !== undefined) setCargoType(patch.cargoType);
                if (patch.cargoPrice !== undefined) setCargoPrice(patch.cargoPrice);
              }}
            />
            <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
              <aside className="flex flex-col gap-3 min-w-0">
                <ManualFilters
                  sizes={merchantData.sizes}
                  cargoTypes={merchantData.cargoTypes}
                  cargoPrices={merchantData.cargoPrices}
                  mapModes={mapModes}
                  size={size}
                  cargoType={cargoType}
                  cargoPrice={cargoPrice}
                  mapModeId={mapModeId}
                  noiseFloor={noiseFloor}
                  raidContextElsewhere
                  onChange={(patch) => {
                    if (patch.size !== undefined) setSize(patch.size);
                    if (patch.cargoType !== undefined) setCargoType(patch.cargoType);
                    if (patch.cargoPrice !== undefined) setCargoPrice(patch.cargoPrice);
                    if (patch.mapModeId !== undefined) setMapModeId(patch.mapModeId);
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
                    lowConfidence={locked?.lowConfidence}
                    redChancePercent={locked?.redChancePercent}
                    altMatches={locked?.alt}
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
        hasCaptureWav={Boolean(burstCaptureUrl)}
        onDownloadWav={downloadBurstCapture}
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
              logPlayerMissReport({
                predictedId: slot.soundId,
                expectedId: actual.soundId,
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

      <footer className="mt-auto border-t border-[var(--border)] px-3 py-3 text-center space-y-1.5">
        <div className="text-[11px] tabular-nums text-[var(--muted)]">v{__APP_VERSION__}</div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => setSuggestionsOpen(true)}
            className="bg-transparent border-none p-0 text-[11px] text-[var(--accent)] underline-offset-2 hover:underline cursor-pointer"
          >
            💡 Suggestions
          </button>
          <button
            type="button"
            onClick={openStats}
            className="bg-transparent border-none p-0 text-[11px] text-[var(--accent)] underline-offset-2 hover:underline cursor-pointer"
          >
            Stats
          </button>
          <button
            type="button"
            onClick={openPools}
            className="bg-transparent border-none p-0 text-[11px] text-[var(--accent)] underline-offset-2 hover:underline cursor-pointer"
          >
            Map Pools
          </button>
        </div>
        <p className="m-0 mx-auto max-w-xl text-[10px] leading-snug text-[var(--muted)]">
          Independent fan companion — not affiliated with Morefun Studios, Tencent Games, or ABI
          Builder. Catalog courtesy of the public explorer at{' '}
          <a
            href="https://abibuilder.com/merchant"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            abibuilder.com/merchant
          </a>
          . Audio stays on your device.
        </p>
      </footer>
    </div>
  );
}
