import {
  ArrowLeft, Bell, Check, CheckCircle, Copy, Cpu, Eye, EyeSlash, GithubLogo,
  Globe, GraphicsCard, Info, LockKey, MagicWand, Pause, Play, ShieldCheck,
  SlidersHorizontal, Sparkle, Stop, TelegramLogo, X,
} from '@phosphor-icons/react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { TgsSticker, type StickerName } from './components/TgsSticker';
import {
  alternateLocale, detectLocale, generatorHref, homeHref, translate,
  type Locale, type MessageKey,
} from './i18n';
import {
  createSearchWorkerPlan, getBrowserConcurrencyPolicy, resolveWorkerCount,
  type ConcurrencySelection,
} from './lib/concurrency';
import {
  collectDeviceProfile, recommendDeviceSettings,
  type DeviceProfile, type DeviceSettingsRecommendation,
} from './lib/device-profile';
import {
  createPerformanceCalibrationPlan, selectFastestCalibrationResult,
  type PerformanceCalibrationResult, type PerformanceCalibrationStep,
} from './lib/performance-calibration';
import type {
  AddressFormat, ComputeEngine, FoundCandidate, FoundWallet, MnemonicScheme,
  SearchOptions, SearchProgress, WalletVersion, WorkerResponse,
} from './types';

type Screen = 'setup' | 'searching' | 'found' | 'seed-ready' | 'seed';
type CopyTarget = 'address' | 'seed' | null;
const TelegramRotation = lazy(() => import('./components/TelegramRotation').then((module) => ({ default: module.TelegramRotation })));

const PRESETS = ['GRAM', 'MONEY', 'TON', 'DUCK'];
const GPU_PIPELINE_STABILITY_CAP = 16;
const WALLET_LABELS: Record<WalletVersion, string> = {
  w5: 'W5', v4r2: 'v4R2', tg: 'tgWallet',
};

function maximumGpuPipelineCount(
  policy: ReturnType<typeof getBrowserConcurrencyPolicy>,
): number {
  // GPU workers spend much of their time waiting for a dispatch. Profiling on
  // an 8-thread/RTX 5060 system peaked at 16 lanes, so GPU concurrency may
  // profitably exceed the logical CPU count without changing CPU limits.
  return Math.min(GPU_PIPELINE_STABILITY_CAP, Math.max(1, policy.maximumWorkerCount * 2));
}

function resolveEngineWorkerCount(
  engine: ComputeEngine,
  selection: ConcurrencySelection,
  policy: ReturnType<typeof getBrowserConcurrencyPolicy>,
): number {
  if (engine === 'cpu') return resolveWorkerCount(selection, policy);
  if (selection === 'auto') {
    return Math.min(8, Math.max(1, Math.ceil(policy.maximumWorkerCount / 2)));
  }
  const maximum = maximumGpuPipelineCount(policy);
  if (selection === 'maximum') return maximum;
  if (!Number.isFinite(selection)) return Math.min(8, maximum);
  return Math.min(maximum, Math.max(1, Math.floor(selection)));
}

function expectedAttempts(suffix: string, caseSensitive: boolean): number {
  if (!suffix) return 0;
  if (caseSensitive) return 64 ** suffix.length;
  const letters = [...suffix].filter((character) => /[a-z]/i.test(character)).length;
  return 64 ** suffix.length / 2 ** letters;
}

function compactNumber(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return '∞';
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1,
  }).format(Math.round(value));
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function TonSuiteMark({ locale }: { locale: Locale }) {
  return (
    <a className="brand" href={homeHref(locale)} aria-label={translate(locale, 'nav.home')}>
      <img src={`${import.meta.env.BASE_URL}brand/tonsuite-icon.jpg`} width="38" height="38" alt="" aria-hidden="true" />
      <span><b>Ton</b>Suite</span>
    </a>
  );
}

function StatusPill({ locale }: { locale: Locale }) {
  return <span className="local-pill"><span className="local-pill__dot" />{translate(locale, 'status.local')}</span>;
}

function ScreenSticker({ screen, locale }: { screen: Screen; locale: Locale }) {
  const stickers: Record<Screen, { name: StickerName; label: MessageKey }> = {
    setup: { name: 'thinking', label: 'sticker.setup' },
    searching: { name: 'hunting', label: 'sticker.searching' },
    found: { name: 'success', label: 'sticker.found' },
    'seed-ready': { name: 'secret', label: 'sticker.seed' },
    seed: { name: 'secret', label: 'sticker.seed' },
  };
  const sticker = stickers[screen];
  return <TgsSticker name={sticker.name} label={translate(locale, sticker.label)} />;
}

function HighlightedAddress({ address, suffix }: { address: string; suffix: string }) {
  const prefix = address.slice(0, Math.max(0, address.length - suffix.length));
  const ending = address.slice(-suffix.length);
  return <span className="address-text">{prefix}<strong>{ending}</strong></span>;
}

export function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useCallback(
    (key: MessageKey, values: Record<string, string | number> = {}) => translate(locale, key, values),
    [locale],
  );
  const concurrencyPolicy = useMemo(() => getBrowserConcurrencyPolicy(), []);
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [screen, setScreen] = useState<Screen>('setup');
  const [rotationOpen, setRotationOpen] = useState(() => {
    try { return location.hash === '#rotate' || !!localStorage.getItem('tonsuite:tg-rotation:pending:v1'); }
    catch { return location.hash === '#rotate'; }
  });
  const [rotationAddress, setRotationAddress] = useState('');
  const openRotation = (address = '') => {
    setRotationAddress(address); setSeedVisible(false); setRotationOpen(true);
    window.history.replaceState(null, '', `${location.pathname}#rotate`);
  };
  const [suffix, setSuffix] = useState('GRAM');
  const [version, setVersion] = useState<WalletVersion>('w5');
  const [mnemonicScheme, setMnemonicScheme] = useState<MnemonicScheme>('multichain-12');
  const [addressFormat, setAddressFormat] = useState<AddressFormat>('non-bounceable');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [safeToReveal, setSafeToReveal] = useState(false);
  const [concurrencySelection, setConcurrencySelection] = useState<ConcurrencySelection>('auto');
  const [engine, setEngine] = useState<ComputeEngine>('cpu');
  const [activeEngine, setActiveEngine] = useState<ComputeEngine>('cpu');
  const [engineNotice, setEngineNotice] = useState('');
  const [liveMessage, setLiveMessage] = useState('');
  const gpuApiAvailable = useMemo(() => (
    typeof navigator !== 'undefined' && 'gpu' in navigator && concurrencyPolicy.gpuAllowed
  ), [concurrencyPolicy.gpuAllowed]);
  const [progress, setProgress] = useState<SearchProgress>({
    attempts: 0, elapsedMs: 0, attemptsPerSecond: 0, sampleAddress: '',
  });
  const [foundCandidate, setFoundCandidate] = useState<FoundCandidate | null>(null);
  const [foundWallet, setFoundWallet] = useState<FoundWallet | null>(null);
  const [error, setError] = useState('');
  const [copyTarget, setCopyTarget] = useState<CopyTarget>(null);
  const [seedVisible, setSeedVisible] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [huntStartedOpen, setHuntStartedOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [powerEngine, setPowerEngine] = useState<ComputeEngine>('cpu');
  const [powerSelection, setPowerSelection] = useState<ConcurrencySelection>('auto');
  const [activeWorkerCount, setActiveWorkerCount] = useState(0);
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<{
    current: number; total: number; engine: ComputeEngine; count: number;
  } | null>(null);
  const [calibrationResult, setCalibrationResult] = useState<PerformanceCalibrationResult | null>(null);
  const [calibrationFailed, setCalibrationFailed] = useState(false);

  const workersRef = useRef<Worker[]>([]);
  const winningWorkerRef = useRef<Worker | null>(null);
  const workerProgressRef = useRef(new Map<number, SearchProgress>());
  const workerEngineRef = useRef(new Map<number, ComputeEngine>());
  const searchEpochRef = useRef(0);
  const baselineAttemptsRef = useRef(0);
  const baselineElapsedMsRef = useRef(0);
  const activeSegmentStartedAtRef = useRef(0);
  const latestProgressRef = useRef<SearchProgress>({
    attempts: 0, elapsedMs: 0, attemptsPerSecond: 0, sampleAddress: '',
  });
  const isPausedRef = useRef(false);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const progressAnnouncementRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const huntModalCloseRef = useRef<HTMLButtonElement | null>(null);
  const calibrationWorkersRef = useRef<Worker[]>([]);
  const calibrationEpochRef = useRef(0);
  const calibrationFinishRef = useRef<(() => void) | null>(null);
  const deviceRecommendation = useMemo<DeviceSettingsRecommendation | null>(
    () => deviceProfile ? recommendDeviceSettings(deviceProfile) : null,
    [deviceProfile],
  );
  const calibrationPlan = useMemo(
    () => deviceProfile && deviceRecommendation
      ? createPerformanceCalibrationPlan({
          profile: deviceProfile,
          recommendation: deviceRecommendation,
          maxCpuWorkers: concurrencyPolicy.maximumWorkerCount,
        })
      : [],
    [concurrencyPolicy.maximumWorkerCount, deviceProfile, deviceRecommendation],
  );
  const calibrationDurationSeconds = Math.ceil(
    calibrationPlan.reduce((sum, step) => sum + step.durationMs, 0) / 1_000,
  );
  const gpuAvailable = deviceProfile
    ? deviceProfile.webgpu.adapterAvailable && !deviceProfile.mobile
    : gpuApiAvailable;

  const cleanSuffix = suffix.trim();
  const workerCount = resolveEngineWorkerCount(engine, concurrencySelection, concurrencyPolicy);
  const workerCountOptions = engine === 'gpu'
    ? Array.from({ length: maximumGpuPipelineCount(concurrencyPolicy) }, (_, index) => index + 1)
    : concurrencyPolicy.workerCountOptions;
  const autoWorkerCount = resolveEngineWorkerCount(engine, 'auto', concurrencyPolicy);
  const maximumWorkerCount = resolveEngineWorkerCount(engine, 'maximum', concurrencyPolicy);
  const powerWorkerCount = resolveEngineWorkerCount(
    powerEngine,
    powerSelection,
    concurrencyPolicy,
  );
  const powerWorkerCountOptions = powerEngine === 'gpu'
    ? Array.from({ length: maximumGpuPipelineCount(concurrencyPolicy) }, (_, index) => index + 1)
    : concurrencyPolicy.workerCountOptions;
  const powerAutoWorkerCount = resolveEngineWorkerCount(powerEngine, 'auto', concurrencyPolicy);
  const powerMaximumWorkerCount = resolveEngineWorkerCount(powerEngine, 'maximum', concurrencyPolicy);
  const suffixError = useMemo(() => {
    if (!cleanSuffix) return t('suffix.required');
    if (!/^[A-Za-z0-9_-]+$/.test(cleanSuffix)) return t('suffix.characters');
    if (cleanSuffix.length > 8) return t('suffix.maximum');
    return '';
  }, [cleanSuffix, t]);
  const attemptsEstimate = useMemo(
    () => expectedAttempts(cleanSuffix, caseSensitive), [caseSensitive, cleanSuffix],
  );

  useEffect(() => {
    const isEnglish = locale === 'en';
    document.documentElement.lang = locale;
    document.title = isEnglish
      ? 'TON Vanity Address Generator — tgWallet, W5 & v4R2 | TonSuite'
      : 'Генератор TON-адресов: tgWallet, W5 и v4R2 | TonSuite';
    const description = isEnglish
      ? 'Generate vanity TON addresses for Telegram (tgWallet), W5 and v4R2 locally. Recovery phrases stay on your device.'
      : 'Создайте красивый TON-адрес для Telegram (tgWallet), W5 или v4R2. Генерация выполняется на вашем устройстве, без отправки секретной фразы на сервер.';
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute(
      'href',
      isEnglish ? 'https://tonsuite.org/en/generator/' : 'https://tonsuite.org/generator/',
    );
    document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.setAttribute(
      'content',
      isEnglish ? 'https://tonsuite.org/en/generator/' : 'https://tonsuite.org/generator/',
    );
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    void collectDeviceProfile().then((profile) => {
      if (cancelled) return;
      setDeviceProfile(profile);
    }).catch(() => {
      if (!cancelled) setDeviceProfile(null);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('#generator-main h1');
    window.requestAnimationFrame(() => heading?.focus());
  }, [screen]);

  useEffect(() => {
    const syncLocaleFromHistory = () => setLocale(detectLocale());
    window.addEventListener('popstate', syncLocaleFromHistory);
    return () => window.removeEventListener('popstate', syncLocaleFromHistory);
  }, []);

  const estimateLabel = useCallback((attempts: number): string => {
    if (!attempts) return t('estimate.enter');
    const count = compactNumber(attempts, locale);
    if (attempts < 1_000) return t('estimate.attempts', { count });
    if (attempts < 100_000_000) return t('estimate.realistic', { count });
    if (attempts < 10_000_000_000) return t('estimate.long', { count });
    return t('estimate.veryLong', { count });
  }, [locale, t]);

  const formatEta = useCallback((milliseconds: number): string => {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return t('eta.measuring');
    const hours = milliseconds / 3_600_000;
    if (hours < 1) return t('eta.minutes', { count: Math.max(1, Math.round(milliseconds / 60_000)) });
    if (hours < 48) return t('eta.hours', { count: Math.round(hours) });
    const days = hours / 24;
    if (days < 730) return t('eta.days', { count: Math.round(days) });
    return t('eta.years', { count: Math.round(days / 365) });
  }, [t]);

  const updateProgress = useCallback((nextProgress: SearchProgress) => {
    latestProgressRef.current = nextProgress;
    setProgress(nextProgress);
  }, []);

  const stopWorkers = useCallback(() => {
    searchEpochRef.current += 1;
    workersRef.current.forEach((worker) => { worker.postMessage({ type: 'stop' }); worker.terminate(); });
    workersRef.current = [];
    winningWorkerRef.current = null;
    workerProgressRef.current.clear();
    workerEngineRef.current.clear();
  }, []);

  const terminateCalibrationWorkers = useCallback(() => {
    calibrationWorkersRef.current.forEach((worker) => {
      worker.postMessage({ type: 'stop' });
      window.setTimeout(() => worker.terminate(), 50);
    });
    calibrationWorkersRef.current = [];
  }, []);

  const cancelPerformanceCalibration = useCallback(() => {
    calibrationEpochRef.current += 1;
    calibrationFinishRef.current?.();
    calibrationFinishRef.current = null;
    terminateCalibrationWorkers();
    setCalibrationRunning(false);
    setCalibrationStep(null);
  }, [terminateCalibrationWorkers]);

  useEffect(() => stopWorkers, [stopWorkers]);
  useEffect(() => () => {
    calibrationEpochRef.current += 1;
    calibrationFinishRef.current?.();
    calibrationFinishRef.current = null;
    terminateCalibrationWorkers();
  }, [terminateCalibrationWorkers]);

  useEffect(() => {
    if (!calibrationRunning) return;
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancelPerformanceCalibration();
    };
    document.addEventListener('visibilitychange', cancelWhenHidden);
    window.addEventListener('pagehide', cancelPerformanceCalibration);
    return () => {
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      window.removeEventListener('pagehide', cancelPerformanceCalibration);
    };
  }, [calibrationRunning, cancelPerformanceCalibration]);

  useEffect(() => () => {
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  useEffect(() => {
    if (!huntStartedOpen) return;
    window.requestAnimationFrame(() => huntModalCloseRef.current?.focus());
    const handleModalKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHuntStartedOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...document.querySelectorAll<HTMLElement>(
        '.hunt-modal button:not(:disabled), .hunt-modal a[href]',
      )];
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleModalKeyboard);
    return () => window.removeEventListener('keydown', handleModalKeyboard);
  }, [huntStartedOpen]);

  useEffect(() => {
    if (screen !== 'searching' || isPaused) return;
    const timer = window.setInterval(() => {
      const elapsedMs = baselineElapsedMsRef.current
        + Math.max(0, Date.now() - activeSegmentStartedAtRef.current);
      setProgress((current) => {
        const next = { ...current, elapsedMs };
        latestProgressRef.current = next;
        return next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [isPaused, screen]);

  useEffect(() => {
    if (screen !== 'found' && screen !== 'seed-ready' && screen !== 'seed') return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [screen]);

  const aggregateProgress = useCallback(() => {
    const values = [...workerProgressRef.current.values()];
    if (!values.length) return;
    const latest = values.reduce((left, right) => right.elapsedMs > left.elapsedMs ? right : left);
    const attempts = baselineAttemptsRef.current
      + values.reduce((sum, item) => sum + item.attempts, 0);
    const attemptsPerSecond = values.reduce((sum, item) => sum + item.attemptsPerSecond, 0);
    updateProgress({
      attempts,
      attemptsPerSecond: values.reduce((sum, item) => sum + item.attemptsPerSecond, 0),
      elapsedMs: baselineElapsedMsRef.current
        + Math.max(0, Date.now() - activeSegmentStartedAtRef.current),
      sampleAddress: latest.sampleAddress,
    });
    const now = Date.now();
    if (now - progressAnnouncementRef.current >= 4_000) {
      setLiveMessage(`${compactNumber(attempts, locale)} · ${compactNumber(attemptsPerSecond, locale)}/s`);
      progressAnnouncementRef.current = now;
    }
  }, [locale, updateProgress]);

  const prepareFoundAlerts = useCallback(() => {
    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audioContextRef.current && AudioContextConstructor) {
      try { audioContextRef.current = new AudioContextConstructor(); } catch { /* Audio is optional. */ }
    }
    void audioContextRef.current?.resume().catch(() => undefined);

    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const announceFoundWallet = useCallback(() => {
    const context = audioContextRef.current;
    if (context) {
      void context.resume().then(() => {
        const startedAt = context.currentTime;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, startedAt);
        gain.gain.exponentialRampToValueAtTime(0.22, startedAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 1.15);
        gain.connect(context.destination);
        [659.25, 783.99, 1046.5].forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const noteGain = context.createGain();
          const noteStart = startedAt + index * 0.18;
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(frequency, noteStart);
          noteGain.gain.setValueAtTime(0.0001, noteStart);
          noteGain.gain.exponentialRampToValueAtTime(1, noteStart + 0.018);
          noteGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.34);
          oscillator.connect(noteGain);
          noteGain.connect(gain);
          oscillator.start(noteStart);
          oscillator.stop(noteStart + 0.36);
        });
      }).catch(() => undefined);
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(t('notification.title'), {
          body: t('notification.body'),
          icon: `${import.meta.env.BASE_URL}brand/tonsuite-icon.jpg`,
          tag: 'tonsuite-wallet-found',
        });
      } catch { /* System notifications are optional. */ }
    }
  }, [t]);

  const snapshotSearchProgress = useCallback((): SearchProgress => {
    const values = [...workerProgressRef.current.values()];
    const latest = values.length
      ? values.reduce((left, right) => right.elapsedMs > left.elapsedMs ? right : left)
      : latestProgressRef.current;
    return {
      attempts: baselineAttemptsRef.current
        + values.reduce((sum, item) => sum + item.attempts, 0),
      attemptsPerSecond: values.reduce((sum, item) => sum + item.attemptsPerSecond, 0),
      elapsedMs: baselineElapsedMsRef.current + (
        activeSegmentStartedAtRef.current > 0
          ? Math.max(0, Date.now() - activeSegmentStartedAtRef.current)
          : 0
      ),
      sampleAddress: latest.sampleAddress,
    };
  }, []);

  const preserveSearchProgressAndStop = useCallback((): SearchProgress => {
    const snapshot = snapshotSearchProgress();
    baselineAttemptsRef.current = snapshot.attempts;
    baselineElapsedMsRef.current = snapshot.elapsedMs;
    activeSegmentStartedAtRef.current = 0;
    const pausedSnapshot = { ...snapshot, attemptsPerSecond: 0 };
    updateProgress(pausedSnapshot);
    stopWorkers();
    return pausedSnapshot;
  }, [snapshotSearchProgress, stopWorkers, updateProgress]);

  const launchWorkers = useCallback((
    requestedEngine: ComputeEngine,
    requestedSelection: ConcurrencySelection,
  ) => {
    const nextEngine: ComputeEngine = requestedEngine === 'gpu'
      && gpuAvailable && concurrencyPolicy.gpuAllowed ? 'gpu' : 'cpu';
    const nextWorkerCount = resolveEngineWorkerCount(
      nextEngine,
      requestedSelection,
      concurrencyPolicy,
    );
    const nextWorkerPlan = createSearchWorkerPlan(nextEngine, nextWorkerCount);
    const epoch = searchEpochRef.current + 1;
    searchEpochRef.current = epoch;
    activeSegmentStartedAtRef.current = Date.now();
    setActiveEngine(nextEngine);
    setActiveWorkerCount(nextWorkerPlan.length);

    const baseOptions: SearchOptions = {
      suffix: cleanSuffix, version, addressFormat, caseSensitive, engine: nextEngine, locale,
      mnemonicScheme,
    };

    const nextWorkers = nextWorkerPlan.map((workerEngine, workerId) => {
      const worker = new Worker(new URL('./workers/vanity.worker.ts', import.meta.url), {
        type: 'module', name: `ton-vanity-${workerEngine}-${workerId}`,
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (epoch !== searchEpochRef.current) return;
        const message = event.data;
        if (message.type === 'engine') {
          workerEngineRef.current.set(message.workerId, message.engine);
          const reportedEngines = [...workerEngineRef.current.values()];
          if (reportedEngines.includes('gpu')) setActiveEngine('gpu');
          else if (workerEngineRef.current.size === nextWorkerPlan.length) setActiveEngine('cpu');
          if (message.fallbackReason) setEngineNotice(t('error.gpuFallback'));
        }
        if (message.type === 'progress') {
          workerProgressRef.current.set(message.workerId, message.progress);
          aggregateProgress();
        }
        if (message.type === 'candidate') {
          if (winningWorkerRef.current && winningWorkerRef.current !== worker) {
            worker.postMessage({ type: 'stop' }); worker.terminate(); return;
          }
          winningWorkerRef.current = worker;
          workerProgressRef.current.set(message.workerId, {
            attempts: message.candidate.attempts, attemptsPerSecond: 0,
            elapsedMs: message.candidate.elapsedMs, sampleAddress: message.candidate.address,
          });
          const totalAttempts = baselineAttemptsRef.current
            + [...workerProgressRef.current.values()].reduce((sum, item) => sum + item.attempts, 0);
          const elapsedMs = baselineElapsedMsRef.current
            + Math.max(0, Date.now() - activeSegmentStartedAtRef.current);
          setFoundCandidate({ ...message.candidate, attempts: totalAttempts, elapsedMs });
          setLiveMessage(t('found.status'));
          workersRef.current.forEach((otherWorker) => {
            if (otherWorker !== worker) { otherWorker.postMessage({ type: 'stop' }); otherWorker.terminate(); }
          });
          workersRef.current = [worker];
          announceFoundWallet();
          setScreen('found');
        }
        if (message.type === 'revealed') {
          setFoundWallet(message.wallet); setSeedVisible(true); setRevealPending(false);
          setLiveMessage(t('seed.title', {
            count: message.wallet.mnemonicScheme === 'ton-24' ? 24 : 12,
          }));
          setScreen('seed'); stopWorkers();
        }
        if (message.type === 'error') {
          setError(message.message || t('error.generator')); setScreen('setup'); stopWorkers();
        }
      };
      worker.onerror = () => {
        if (epoch !== searchEpochRef.current) return;
        setError(t('error.generator')); setScreen('setup'); stopWorkers();
      };
      worker.postMessage({
        type: 'start',
        options: { ...baseOptions, engine: workerEngine },
        workerId,
      });
      return worker;
    });
    workersRef.current = nextWorkers;
  }, [addressFormat, aggregateProgress, announceFoundWallet, caseSensitive, cleanSuffix,
    concurrencyPolicy, gpuAvailable, locale, mnemonicScheme, stopWorkers, t, version]);

  const benchmarkPerformanceStep = useCallback((
    step: PerformanceCalibrationStep,
    epoch: number,
  ): Promise<PerformanceCalibrationResult> => new Promise((resolve) => {
    const latestProgress = new Map<number, SearchProgress>();
    const reportedEngines = new Map<number, ComputeEngine>();
    let baselineProgress = new Map<number, SearchProgress>();
    const workers: Worker[] = [];
    let fallback = false;
    let failed = false;
    let finished = false;
    let measurementStarted = false;
    let startupTimeoutId = 0;
    let measurementTimeoutId = 0;

    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(startupTimeoutId);
      window.clearTimeout(measurementTimeoutId);
      workers.forEach((worker) => {
        worker.postMessage({ type: 'stop' });
        window.setTimeout(() => worker.terminate(), 50);
      });
      if (calibrationWorkersRef.current === workers) calibrationWorkersRef.current = [];
      if (calibrationFinishRef.current === finish) calibrationFinishRef.current = null;

      let attemptsPerSecond = 0;
      let allLanesMeasured = measurementStarted
        && baselineProgress.size === step.count
        && latestProgress.size === step.count
        && reportedEngines.size === step.count;
      for (let workerId = 0; workerId < step.count; workerId += 1) {
        const baseline = baselineProgress.get(workerId);
        const latest = latestProgress.get(workerId);
        const reportedEngine = reportedEngines.get(workerId);
        if (!baseline || !latest || reportedEngine !== step.engine) {
          allLanesMeasured = false;
          continue;
        }
        const attemptDelta = latest.attempts - baseline.attempts;
        const elapsedDelta = latest.elapsedMs - baseline.elapsedMs;
        if (attemptDelta <= 0 || elapsedDelta <= 0) {
          allLanesMeasured = false;
          continue;
        }
        attemptsPerSecond += (attemptDelta * 1_000) / elapsedDelta;
      }
      resolve({
        engine: step.engine,
        count: step.count,
        attemptsPerSecond,
        valid: epoch === calibrationEpochRef.current
          && !failed && !fallback && allLanesMeasured && attemptsPerSecond > 0,
        fallback,
        failed,
      });
    };

    const startMeasurementWhenReady = () => {
      if (measurementStarted || finished) return;
      if (reportedEngines.size !== step.count || latestProgress.size !== step.count) return;
      for (let workerId = 0; workerId < step.count; workerId += 1) {
        if (reportedEngines.get(workerId) !== step.engine) {
          fallback = true;
          finish();
          return;
        }
      }
      measurementStarted = true;
      baselineProgress = new Map(latestProgress);
      window.clearTimeout(startupTimeoutId);
      measurementTimeoutId = window.setTimeout(finish, step.durationMs);
    };

    calibrationFinishRef.current = finish;
    startupTimeoutId = window.setTimeout(() => {
      failed = true;
      finish();
    }, mnemonicScheme === 'ton-24'
      ? 30_000
      : Math.max(6_000, step.durationMs * 3));
    const benchmarkOptions: SearchOptions = {
      // Eight exact underscores are valid TON base64url characters but have a
      // negligible hit probability during a few-second calibration sample.
      suffix: '________',
      version,
      addressFormat,
      caseSensitive: true,
      engine: step.engine,
      locale,
      mnemonicScheme,
    };

    calibrationWorkersRef.current = workers;
    try {
      for (let workerId = 0; workerId < step.count; workerId += 1) {
        const worker = new Worker(new URL('./workers/vanity.worker.ts', import.meta.url), {
          type: 'module',
          name: `ton-calibration-${step.engine}-${workerId}`,
        });
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (finished || epoch !== calibrationEpochRef.current) return;
          const message = event.data;
          if (message.type === 'engine') {
            reportedEngines.set(message.workerId, message.engine);
            if (message.engine !== step.engine) fallback = true;
            startMeasurementWhenReady();
          }
          if (message.type === 'progress') {
            latestProgress.set(message.workerId, message.progress);
            startMeasurementWhenReady();
          }
          if (message.type === 'error' || message.type === 'candidate') {
            failed = true;
            finish();
          }
        };
        worker.onerror = () => {
          failed = true;
          finish();
        };
        workers.push(worker);
        worker.postMessage({ type: 'start', options: benchmarkOptions, workerId });
      }
    } catch {
      failed = true;
      finish();
    }
  }), [addressFormat, locale, mnemonicScheme, version]);

  const startSearch = useCallback(() => {
    const nextEngine = concurrencyPolicy.gpuAllowed ? engine : 'cpu';
    if (suffixError || (nextEngine === 'gpu' && !gpuAvailable)) return;
    cancelPerformanceCalibration();
    prepareFoundAlerts();
    setHuntStartedOpen(true);
    stopWorkers();
    baselineAttemptsRef.current = 0;
    baselineElapsedMsRef.current = 0;
    activeSegmentStartedAtRef.current = 0;
    isPausedRef.current = false;
    setIsPaused(false); setPowerOpen(false);
    setError(''); setEngineNotice('');
    setLiveMessage(t('search.running'));
    progressAnnouncementRef.current = Date.now();
    setFoundCandidate(null); setFoundWallet(null); setRevealPending(false);
    setSeedVisible(false); setCopyTarget(null);
    updateProgress({ attempts: 0, elapsedMs: 0, attemptsPerSecond: 0, sampleAddress: '' });
    setScreen('searching');
    launchWorkers(nextEngine, concurrencySelection);
  }, [cancelPerformanceCalibration, concurrencyPolicy.gpuAllowed, concurrencySelection, engine,
    gpuAvailable, launchWorkers, prepareFoundAlerts, stopWorkers, suffixError, t, updateProgress]);

  const pauseSearch = useCallback(() => {
    if (isPausedRef.current) return;
    preserveSearchProgressAndStop();
    isPausedRef.current = true;
    setIsPaused(true);
    setLiveMessage(t('search.paused'));
  }, [preserveSearchProgressAndStop, t]);

  const resumeSearch = useCallback(() => {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    setIsPaused(false);
    setLiveMessage(t('search.running'));
    progressAnnouncementRef.current = Date.now();
    launchWorkers(engine, concurrencySelection);
  }, [concurrencySelection, engine, launchWorkers, t]);

  const applyPowerSettings = useCallback(() => {
    const nextEngine = concurrencyPolicy.gpuAllowed ? powerEngine : 'cpu';
    if (nextEngine === 'gpu' && !gpuAvailable) return;
    const wasPaused = isPausedRef.current;
    if (!wasPaused) preserveSearchProgressAndStop();
    else stopWorkers();
    setEngine(nextEngine);
    setConcurrencySelection(powerSelection);
    setPowerOpen(false);
    setEngineNotice('');
    if (!wasPaused) {
      isPausedRef.current = false;
      setIsPaused(false);
      setLiveMessage(t('search.running'));
      launchWorkers(nextEngine, powerSelection);
    }
  }, [concurrencyPolicy.gpuAllowed, gpuAvailable, launchWorkers, powerEngine,
    powerSelection, preserveSearchProgressAndStop, stopWorkers, t]);

  const cancelSearch = () => {
    stopWorkers();
    isPausedRef.current = false;
    setIsPaused(false); setPowerOpen(false); setScreen('setup');
  };
  const goBack = () => {
    if (screen === 'searching') cancelSearch();
    else if (screen === 'seed-ready') setScreen('found');
    else if (screen === 'seed') setSeedVisible(false);
    else reset();
  };
  const reset = () => {
    stopWorkers(); setFoundCandidate(null); setFoundWallet(null); setRevealPending(false);
    setSafeToReveal(false); setSeedVisible(false); setCopyTarget(null); setError('');
    baselineAttemptsRef.current = 0; baselineElapsedMsRef.current = 0;
    activeSegmentStartedAtRef.current = 0; isPausedRef.current = false;
    setIsPaused(false); setPowerOpen(false); setActiveWorkerCount(0);
    setLiveMessage(''); setScreen('setup');
  };
  const revealSeed = () => {
    const winningWorker = winningWorkerRef.current;
    if (!winningWorker) { setError(t('error.walletMissing')); reset(); return; }
    setRevealPending(true); winningWorker.postMessage({ type: 'reveal' });
  };
  const switchLocale = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const nextLocale = alternateLocale(locale);
    window.history.pushState(null, '', `${generatorHref(nextLocale)}${rotationOpen ? '#rotate' : ''}`);
    setLocale(nextLocale);
  };
  const copyText = async (text: string, target: Exclude<CopyTarget, null>) => {
    try {
      await navigator.clipboard.writeText(text); setCopyTarget(target);
      setLiveMessage(target === 'address' ? t('found.copiedAddress') : t('seed.copied'));
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopyTarget(null), 1_800);
    } catch { setError(t('error.clipboard')); }
  };

  const runPerformanceCalibration = async () => {
    if (calibrationRunning || calibrationPlan.length === 0) return;
    terminateCalibrationWorkers();
    const epoch = calibrationEpochRef.current + 1;
    calibrationEpochRef.current = epoch;
    setCalibrationRunning(true);
    setCalibrationFailed(false);
    setCalibrationResult(null);

    const results: PerformanceCalibrationResult[] = [];
    try {
      for (let index = 0; index < calibrationPlan.length; index += 1) {
        const step = calibrationPlan[index];
        if (!step || epoch !== calibrationEpochRef.current) return;
        setCalibrationStep({
          current: index + 1,
          total: calibrationPlan.length,
          engine: step.engine,
          count: step.count,
        });
        const result = await benchmarkPerformanceStep(step, epoch);
        if (epoch !== calibrationEpochRef.current) return;
        results.push(result);
      }

      const fastest = selectFastestCalibrationResult(results);
      if (!fastest) {
        setCalibrationFailed(true);
        return;
      }
      setCalibrationResult(fastest);
      setEngine(fastest.engine);
      setConcurrencySelection(fastest.count);
      setPowerEngine(fastest.engine);
      setPowerSelection(fastest.count);
    } catch {
      if (epoch === calibrationEpochRef.current) setCalibrationFailed(true);
    } finally {
      if (epoch === calibrationEpochRef.current) {
        terminateCalibrationWorkers();
        setCalibrationRunning(false);
        setCalibrationStep(null);
      }
    }
  };

  const setupScreen = (
    <>
      <div className="setup-hero">
        <ScreenSticker screen="setup" locale={locale} />
        <div className="hero-copy"><StatusPill locale={locale} /><h1 tabIndex={-1}>{t('setup.title')}</h1><p>{t('setup.description')}</p></div>
      </div>
      <section className="panel setup-panel" aria-labelledby="settings-title">
        <h2 id="settings-title" className="sr-only">{t('settings.title')}</h2>
        <label className="field-label" htmlFor="suffix">{t('suffix.label')}</label>
        <div className={`suffix-field ${suffixError && suffix ? 'suffix-field--error' : ''}`}>
          <span>…</span>
          <input id="suffix" value={suffix}
            onChange={(event) => setSuffix(event.target.value.replace(/\s/g, '').slice(0, 8))}
            placeholder="GRAM" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            aria-describedby="suffix-hint" aria-invalid={Boolean(suffixError)} />
          <span className="character-count">{cleanSuffix.length}/8</span>
        </div>
        <div id="suffix-hint" className={`field-hint ${suffixError ? 'field-hint--error' : ''}`}>{suffixError || estimateLabel(attemptsEstimate)}</div>
        <div className="preset-row" aria-label={t('presets.label')}>
          {PRESETS.map((preset) => <button type="button" key={preset}
            className={cleanSuffix === preset ? 'chip chip--active' : 'chip'}
            aria-pressed={cleanSuffix === preset}
            onClick={() => setSuffix(preset)}>{preset}</button>)}
        </div>

        <div className="setting-block">
          <div className="setting-heading">
            <span className="setting-icon setting-icon--blue"><Sparkle weight="fill" /></span>
            <span><strong>{t('wallet.title')}</strong><small>{t('wallet.description')}</small></span>
          </div>
          <div className="segmented segmented--wallet" role="group" aria-label={t('wallet.group')}>
            <button type="button" aria-pressed={version === 'w5'} disabled={calibrationRunning}
              className={version === 'w5' ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => { setVersion('w5'); setCalibrationResult(null); }}>W5 <span>{t('wallet.recommended')}</span></button>
            <button type="button" aria-pressed={version === 'v4r2'} disabled={calibrationRunning}
              className={version === 'v4r2' ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => { setVersion('v4r2'); setCalibrationResult(null); }}>v4R2 <span>{t('wallet.compatibility')}</span></button>
            <button type="button" aria-pressed={version === 'tg'} disabled={calibrationRunning}
              className={version === 'tg' ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => {
                setVersion('tg'); setMnemonicScheme('multichain-12');
                setAddressFormat('non-bounceable'); setCalibrationResult(null);
              }}>tgWallet <span>Telegram</span></button>
          </div>
          {version === 'tg' && <p className="wallet-hint">{t('telegram.description')}</p>}
        </div>

        <details className="advanced-settings">
          <summary>{t('advanced.title')}</summary>
          <div className="advanced-settings__body">
            <div className="advanced-group">
              <div className="setting-heading">
                <span className="setting-icon setting-icon--violet"><LockKey weight="fill" /></span>
                <span><strong>{t('mnemonic.title')}</strong><small>{t(version === 'tg' ? 'telegram.mnemonic' : 'mnemonic.description')}</small></span>
              </div>
              <div className="segmented" role="group" aria-label={t('mnemonic.title')}>
                <button type="button" aria-pressed={mnemonicScheme === 'multichain-12'} disabled={calibrationRunning}
                  className={mnemonicScheme === 'multichain-12' ? 'segmented__item is-active' : 'segmented__item'}
                  onClick={() => { setMnemonicScheme('multichain-12'); setCalibrationResult(null); }}>
                  {t('mnemonic.12')} <span>{t('mnemonic.fast')}</span></button>
                <button type="button" aria-pressed={mnemonicScheme === 'ton-24'} disabled={calibrationRunning || version === 'tg'}
                  className={mnemonicScheme === 'ton-24' ? 'segmented__item is-active' : 'segmented__item'}
                  onClick={() => { setMnemonicScheme('ton-24'); setCalibrationResult(null); }}>
                  {t('mnemonic.24')} <span>TON</span></button>
              </div>
            </div>

            {concurrencyPolicy.gpuAllowed ? <div className="advanced-group">
              <div className="setting-heading">
                <span className="setting-icon setting-icon--orange"><GraphicsCard weight="fill" /></span>
                <span><strong>{t('compute.title')}</strong><small>{t('compute.description')}</small></span>
              </div>
              <div className="engine-grid" role="group" aria-label={t('compute.title')}>
                <button type="button" aria-pressed={engine === 'cpu'} disabled={calibrationRunning}
                  className={engine === 'cpu' ? 'engine-card is-active' : 'engine-card'} onClick={() => {
                    setEngine('cpu');
                  }}>
                  <Cpu weight="fill" /><span><strong>{t('compute.cpu')}</strong><small>{t('compute.cpuDescription')}</small></span>
                </button>
                <button type="button" aria-pressed={engine === 'gpu'} disabled={!gpuAvailable || calibrationRunning}
                  className={engine === 'gpu' ? 'engine-card is-active' : 'engine-card'} onClick={() => {
                    setEngine('gpu');
                  }}>
                  <GraphicsCard weight="fill" /><span><strong>{t('compute.gpu')}</strong><small>{gpuAvailable ? t('compute.gpuDescription') : t('compute.gpuUnavailable')}</small></span>
                </button>
              </div>
            </div> : <div className="mobile-performance-note">
              <span className="setting-icon setting-icon--green"><Cpu weight="fill" /></span>
              <span><strong>{t('compute.mobileTitle')}</strong><small>{t('compute.mobileDescription', { count: concurrencyPolicy.autoWorkerCount })}</small></span>
            </div>}

            {deviceRecommendation && <div className="performance-tune-row">
              <button type="button" aria-busy={calibrationRunning}
                onClick={calibrationRunning ? cancelPerformanceCalibration : () => void runPerformanceCalibration()}>
                {calibrationRunning ? <Stop weight="fill" />
                  : calibrationResult ? <CheckCircle weight="fill" />
                  : <SlidersHorizontal weight="bold" />}
                <span aria-live="polite"><strong>{calibrationRunning && calibrationStep
                  ? t('device.measuring', {
                      current: calibrationStep.current,
                      total: calibrationStep.total,
                      engine: calibrationStep.engine.toUpperCase(),
                      count: calibrationStep.count,
                    })
                  : calibrationResult ? t('device.measured')
                  : calibrationFailed ? t('device.measureFailed')
                  : t('device.measure')}</strong><small>{calibrationRunning
                    ? t('device.cancelMeasure')
                    : calibrationResult ? t('device.measuredValue', {
                        engine: calibrationResult.engine.toUpperCase(),
                        count: calibrationResult.count,
                        speed: compactNumber(calibrationResult.attemptsPerSecond, locale),
                      })
                    : calibrationFailed ? t('device.measureFailedHint')
                    : t('device.measureHint', { seconds: calibrationDurationSeconds })}</small></span>
              </button>
            </div>}

            <label className="select-row">
              <span className="setting-icon setting-icon--green"><Cpu weight="fill" /></span>
              <span className="toggle-copy"><strong>{t(engine === 'gpu' ? 'threads.gpuTitle' : 'threads.title')}</strong><small>{t(engine === 'gpu' ? 'threads.gpuDescription' : 'threads.description', { count: workerCount })}</small></span>
              <select value={String(concurrencySelection)} disabled={calibrationRunning} onChange={(event) => {
                const value = event.target.value;
                setConcurrencySelection(value === 'auto' || value === 'maximum' ? value : Number(value));
              }}>
                <option value="auto">{t('threads.auto', { count: autoWorkerCount })}</option>
                <option value="maximum">{t('threads.maximum', { count: maximumWorkerCount })}</option>
                {workerCountOptions.map((count) =>
                  <option key={count} value={count}>{t('threads.manual', { count })}</option>)}
              </select>
            </label>

            <label className="toggle-row">
              <span className="setting-icon setting-icon--violet"><MagicWand weight="fill" /></span>
              <span className="toggle-copy"><strong>{t('case.title')}</strong><small>{caseSensitive ? t('case.exact') : t('case.relaxed')}</small></span>
              <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
              <span className="toggle" aria-hidden="true" />
            </label>

            <div className="advanced-group">
              <div className="advanced-label">{t('format.title')}</div>
              <div className="radio-stack">
                <label><input type="radio" name="address-format" disabled={calibrationRunning} checked={addressFormat === 'non-bounceable'} onChange={() => {
                  setAddressFormat('non-bounceable'); setCalibrationResult(null);
                }} />
                  <span><strong>UQ…</strong><small>{t('format.nonBounceable')}</small></span></label>
                <label><input type="radio" name="address-format" disabled={calibrationRunning || version === 'tg'} checked={addressFormat === 'bounceable'} onChange={() => {
                  setAddressFormat('bounceable'); setCalibrationResult(null);
                }} />
                  <span><strong>EQ…</strong><small>{t('format.bounceable')}</small></span></label>
              </div>
              {version === 'tg' && <p className="wallet-hint">{t('telegram.format')}</p>}
            </div>
          </div>
        </details>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      <button type="button" className="primary-button"
        disabled={calibrationRunning || Boolean(suffixError) || (engine === 'gpu' && !gpuAvailable)} onClick={startSearch}>
        <MagicWand weight="bold" /> {t('action.start')}
      </button>
      <p className="privacy-note"><LockKey weight="fill" /> {t('privacy.localCompute')}</p>
    </>
  );

  const engineLabel = activeEngine === 'gpu'
    ? t('engine.gpuParallel', { count: activeWorkerCount })
    : t('engine.cpu', { count: activeWorkerCount });
  const searchingScreen = (
    <>
      <ScreenSticker screen="searching" locale={locale} />
      <div className="hero-copy"><StatusPill locale={locale} /><h1 tabIndex={-1}>{t('search.title')}</h1>
        <p>{t('search.description', { suffix: cleanSuffix, version: WALLET_LABELS[version], engine: engineLabel })}</p></div>
      {engineNotice && <div className="notice-banner" role="status">{engineNotice}</div>}
      <section className={isPaused ? 'panel progress-panel is-paused' : 'panel progress-panel'}>
        <div className="pulse-orbit" aria-hidden="true"><span /></div>
        <div className={isPaused ? 'live-label is-paused' : 'live-label'}><span /> {t(isPaused ? 'search.paused' : 'search.running')}</div>
        <div className="attempts-number">{compactNumber(progress.attempts, locale)}</div>
        <div className="attempts-caption">{t('search.attempts')}</div>
        <div className="stats-grid">
          <div><small>{t('search.speed')}</small><strong>{compactNumber(progress.attemptsPerSecond, locale)}/s</strong></div>
          <div><small>{t('search.time')}</small><strong>{formatDuration(progress.elapsedMs)}</strong></div>
          <div><small>{t('search.estimate')}</small><strong>{formatEta((attemptsEstimate / progress.attemptsPerSecond) * 1_000)}</strong></div>
        </div>
        <div className="sample-address"><small>{t('search.sample')}</small><span>{progress.sampleAddress || t('search.preparing')}</span></div>
      </section>
      <div className="probability-note"><Info weight="fill" /><span>{t('search.random')}</span></div>
      <div className="search-actions">
        <button type="button" className="secondary-button" onClick={isPaused ? resumeSearch : pauseSearch}>
          {isPaused ? <Play weight="fill" /> : <Pause weight="fill" />} {t(isPaused ? 'search.resume' : 'search.pause')}
        </button>
        <button type="button" className="secondary-button" aria-expanded={powerOpen} aria-controls="power-settings"
          onClick={() => {
            setPowerEngine(engine); setPowerSelection(concurrencySelection);
            setPowerOpen((open) => !open);
          }}>
          <SlidersHorizontal weight="bold" /> {t('search.power')}
        </button>
      </div>
      {powerOpen && <section id="power-settings" className="panel power-panel" aria-labelledby="power-title">
        <div className="power-panel__header">
          <div><h2 id="power-title">{t('power.title')}</h2><p>{t('power.description')}</p></div>
          <button type="button" className="icon-button" aria-label={t('power.close')} onClick={() => setPowerOpen(false)}><X weight="bold" /></button>
        </div>
        {concurrencyPolicy.gpuAllowed && <div className="engine-grid" role="group" aria-label={t('compute.title')}>
          <button type="button" aria-pressed={powerEngine === 'cpu'}
            className={powerEngine === 'cpu' ? 'engine-card is-active' : 'engine-card'} onClick={() => setPowerEngine('cpu')}>
            <Cpu weight="fill" /><span><strong>{t('compute.cpu')}</strong><small>{t('compute.cpuDescription')}</small></span>
          </button>
          <button type="button" aria-pressed={powerEngine === 'gpu'} disabled={!gpuAvailable}
            className={powerEngine === 'gpu' ? 'engine-card is-active' : 'engine-card'} onClick={() => setPowerEngine('gpu')}>
            <GraphicsCard weight="fill" /><span><strong>{t('compute.gpu')}</strong><small>{gpuAvailable ? t('compute.gpuDescription') : t('compute.gpuUnavailable')}</small></span>
          </button>
        </div>}
        <label className="select-row power-panel__workers">
          <span className="setting-icon setting-icon--green"><Cpu weight="fill" /></span>
          <span className="toggle-copy"><strong>{t(powerEngine === 'gpu' ? 'threads.gpuTitle' : 'threads.title')}</strong>
            <small>{t('power.current', { count: powerWorkerCount })}</small></span>
          <select value={String(powerSelection)} onChange={(event) => {
            const value = event.target.value;
            setPowerSelection(value === 'auto' || value === 'maximum' ? value : Number(value));
          }}>
            <option value="auto">{t('threads.auto', { count: powerAutoWorkerCount })}</option>
            <option value="maximum">{t('threads.maximum', { count: powerMaximumWorkerCount })}</option>
            {powerWorkerCountOptions.map((count) => <option key={count} value={count}>{t('threads.manual', { count })}</option>)}
          </select>
        </label>
        <button type="button" className="primary-button power-panel__apply"
          disabled={powerEngine === 'gpu' && !gpuAvailable} onClick={applyPowerSettings}>
          <Check weight="bold" /> {t('power.apply')}
        </button>
      </section>}
      <button type="button" className="secondary-button danger-button" onClick={cancelSearch}><Stop weight="fill" /> {t('search.stop')}</button>
    </>
  );

  const foundScreen = foundCandidate && (
    <>
      <ScreenSticker screen="found" locale={locale} />
      <div className="hero-copy"><span className="success-pill"><CheckCircle weight="fill" /> {t('found.status')}</span>
        <h1 tabIndex={-1}>{t('found.title')}</h1><p>{t('found.description')}</p></div>
      <section className="panel found-panel">
        <div className="wallet-meta"><span>TON {WALLET_LABELS[foundCandidate.version]}</span>
          <span>{foundCandidate.addressFormat === 'bounceable' ? 'Bounceable' : 'Non-bounceable'}</span></div>
        <div className="found-address"><HighlightedAddress address={foundCandidate.address} suffix={cleanSuffix} />
          <button type="button" className="icon-button" aria-label={t('found.copyAddress')}
            onClick={() => void copyText(foundCandidate.address, 'address')}>
            {copyTarget === 'address' ? <Check weight="bold" /> : <Copy weight="bold" />}</button></div>
        <div className="found-stats"><span><small>{t('found.attempts')}</small><strong>{compactNumber(foundCandidate.attempts, locale)}</strong></span>
          <span><small>{t('found.time')}</small><strong>{formatDuration(foundCandidate.elapsedMs)}</strong></span></div>
      </section>
      {foundCandidate.version === 'tg' && <p className="wallet-hint">{t('telegram.description')}</p>}
      <div className="warning-card"><ShieldCheck weight="fill" />
        <span><strong>{t('found.hiddenTitle')}</strong><small>{t('found.hiddenDescription')}</small></span></div>
      <button type="button" className="primary-button" onClick={() => { setSafeToReveal(false); setScreen('seed-ready'); }}>
        {t('found.reveal')}</button>
      <button type="button" className="text-button" onClick={reset}>{t('found.retry')}</button>
    </>
  );

  const seedReadyScreen = foundCandidate && (
    <>
      <ScreenSticker screen="seed-ready" locale={locale} />
      <div className="hero-copy"><span className="secret-pill"><LockKey weight="fill" /> {t('seedReady.status')}</span>
        <h1 tabIndex={-1}>{t('seedReady.title')}</h1><p>{t('seedReady.description', {
          count: foundCandidate.mnemonicScheme === 'ton-24' ? 24 : 12,
        })}</p></div>
      <div className="seed-warning"><ShieldCheck weight="fill" />
        <span><strong>{t('seed.warningTitle')}</strong><small>{t('seed.warningDescription')}</small></span></div>
      <label className="consent-card">
        <input type="checkbox" checked={safeToReveal} onChange={(event) => setSafeToReveal(event.target.checked)} />
        <span className="checkmark"><Check weight="bold" /></span>
        <span><strong>{t('seedReady.check')}</strong><small>{t('seedReady.checkDescription')}</small></span>
      </label>
      <button type="button" className="primary-button" disabled={!safeToReveal || revealPending} onClick={revealSeed}>
        {revealPending ? t('found.revealPending') : t('seedReady.reveal', {
          count: foundCandidate.mnemonicScheme === 'ton-24' ? 24 : 12,
        })}</button>
      <button type="button" className="text-button" onClick={() => setScreen('found')}>{t('seedReady.back')}</button>
    </>
  );

  const seedScreen = foundWallet && (
    <>
      <ScreenSticker screen="seed" locale={locale} />
      <div className="hero-copy"><span className="secret-pill"><LockKey weight="fill" /> {t('seed.status')}</span>
        <h1 tabIndex={-1}>{t('seed.title', {
          count: foundWallet.mnemonicScheme === 'ton-24' ? 24 : 12,
        })}</h1><p>{t('seed.description')}</p></div>
      <div className="seed-warning"><ShieldCheck weight="fill" />
        <span><strong>{t('seed.warningTitle')}</strong><small>{t('seed.warningDescription')}</small></span></div>
      <section className={`panel seed-panel ${seedVisible ? '' : 'seed-panel--hidden'}`}>
        <div className="seed-toolbar"><span>{t('seed.phrase')}</span>
          <button type="button" aria-pressed={seedVisible} onClick={() => setSeedVisible((value) => !value)}>
            {seedVisible ? <EyeSlash /> : <Eye />} {seedVisible ? t('seed.hide') : t('seed.show')}</button></div>
        {seedVisible ? (
          <ol className="seed-grid">
            {foundWallet.mnemonic.map((word, index) => <li key={`${word}-${index}`}><span>{index + 1}</span><strong>{word}</strong></li>)}
          </ol>
        ) : <div className="seed-hidden-state"><EyeSlash weight="fill" />{t('seed.hidden', {
          count: foundWallet.mnemonicScheme === 'ton-24' ? 24 : 12,
        })}</div>}
        <div className="seed-standard"><span>{foundWallet.version === 'tg'
          ? 'WalletTg · TEP-3' : foundWallet.mnemonicScheme === 'ton-24'
          ? 'TON Mnemonic' : 'BIP39 · SLIP-0010'}</span><code>{foundWallet.mnemonicScheme === 'ton-24'
          ? 'TON default seed' : "m/44'/607'/0'"}</code></div>
        <button type="button" className="copy-seed-button" disabled={!seedVisible}
          onClick={() => void copyText(foundWallet.mnemonic.join(' '), 'seed')}>
          {copyTarget === 'seed' ? <Check weight="bold" /> : <Copy weight="bold" />}
          {copyTarget === 'seed' ? t('seed.copied') : t('seed.copy', {
            count: foundWallet.mnemonicScheme === 'ton-24' ? 24 : 12,
          })}</button>
      </section>
      {foundWallet.version === 'tg' && <section className="panel telegram-guide" aria-labelledby="telegram-guide-title">
        <h2 id="telegram-guide-title"><TelegramLogo weight="fill" />{t('telegram.guideTitle')}</h2>
        <ol>
          <li>{t('telegram.import')}</li>
          <li>{t('telegram.rotate')}</li>
          <li>{t('telegram.save')}</li>
        </ol>
        <p>{t('telegram.availability')}</p>
        <button type="button" className="secondary-button" onClick={() => openRotation(foundWallet.address)}>
          <LockKey />{locale === 'ru' ? 'Сменить фразу этого адреса' : 'Change this address’s phrase'}</button>
      </section>}
      <button type="button" className="primary-button" onClick={reset}>{t('seed.restart')}</button>
      <p className="privacy-note"><LockKey weight="fill" /> {t('seed.notStored')}</p>
    </>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#generator-main">{locale === 'ru' ? 'Перейти к генератору' : 'Skip to generator'}</a>
      <div className="ambient ambient--one" /><div className="ambient ambient--two" />
      <header className="topbar">
        <div className="topbar__leading">
          {!rotationOpen && screen !== 'setup' && screen !== 'seed' && <button type="button" className="back-button"
            onClick={goBack} aria-label={t('nav.back')}><ArrowLeft weight="bold" /></button>}
          <TonSuiteMark locale={locale} />
        </div>
        <nav className="topbar__actions" aria-label={locale === 'ru' ? 'Навигация генератора' : 'Generator navigation'}>
          <a className="language-link" href={generatorHref(alternateLocale(locale))} hrefLang={alternateLocale(locale)} aria-label={t('nav.language')} onClick={switchLocale}>
            <Globe weight="bold" /><span>{t('nav.languageShort')}</span></a>
          <a className="github-link" href="https://github.com/rub1kub/ton-vanity-generator" target="_blank" rel="noreferrer">
            <GithubLogo weight="fill" /> <span>{t('nav.source')}</span></a>
        </nav>
      </header>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</div>
      {error && screen !== 'setup' && <div className="global-error error-banner" role="alert">{error}</div>}
      <main id="generator-main" className={`generator generator--${rotationOpen ? 'rotation' : screen}`}>
        {rotationOpen ? <Suspense fallback={<p role="status">{locale === 'ru' ? 'Загружаем…' : 'Loading…'}</p>}>
          <TelegramRotation locale={locale} initialAddress={rotationAddress} onClose={(completed) => {
            setRotationOpen(false); setRotationAddress('');
            window.history.replaceState(null, '', location.pathname);
            if (completed) reset();
          }} /></Suspense> : <>
          {screen === 'setup' && setupScreen}{screen === 'searching' && searchingScreen}
          {screen === 'found' && foundScreen}{screen === 'seed-ready' && seedReadyScreen}{screen === 'seed' && seedScreen}
          {screen === 'setup' && <button type="button" className="text-button rotation-mode-link" disabled={calibrationRunning}
            onClick={() => openRotation()}><LockKey />{locale === 'ru' ? 'Сменить сид-фразу tgWallet →' : 'Change a tgWallet recovery phrase →'}</button>}
        </>}
      </main>
      {huntStartedOpen && <div className="hunt-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setHuntStartedOpen(false);
      }}>
        <section className="hunt-modal" role="dialog" aria-modal="true" aria-labelledby="hunt-modal-title" aria-describedby="hunt-modal-description">
          <button ref={huntModalCloseRef} type="button" className="hunt-modal__close" aria-label={t('huntModal.close')}
            onClick={() => setHuntStartedOpen(false)}><X weight="bold" /></button>
          <span className="hunt-modal__icon" aria-hidden="true"><Bell weight="fill" /></span>
          <span className="hunt-modal__eyebrow">{t('huntModal.status')}</span>
          <h2 id="hunt-modal-title">{t('huntModal.title')}</h2>
          <p id="hunt-modal-description">{t('huntModal.description')}</p>
          <div className="hunt-modal__notice"><Bell weight="fill" /><span>{t('huntModal.notification')}</span></div>
          <a className="primary-button hunt-modal__channel" href="https://t.me/rubikub" target="_blank" rel="noreferrer"
            onClick={() => setHuntStartedOpen(false)}><TelegramLogo weight="fill" /> {t('huntModal.subscribe')}</a>
          <button type="button" className="hunt-modal__continue" onClick={() => setHuntStartedOpen(false)}>{t('huntModal.continue')}</button>
        </section>
      </div>}
      <footer className="site-footer"><span>© {new Date().getFullYear()} TonSuite</span>
        <a href={locale === 'ru' ? '/privacy/' : '/en/privacy/'}>{t('footer.privacy')}</a>
        <a href="https://t.me/addstickers/UtyaDuck" target="_blank" rel="noreferrer">{t('footer.utya')}</a>
        <a href="https://t.me/rub1kub" target="_blank" rel="noreferrer">{t('footer.author')}</a>
        <a href="https://t.me/rubikub" target="_blank" rel="noreferrer">{t('footer.channel')}</a></footer>
    </div>
  );
}
