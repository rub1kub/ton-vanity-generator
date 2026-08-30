import {
  ArrowLeft, Check, CheckCircle, Copy, Cpu, Eye, EyeSlash, GithubLogo,
  Globe, GraphicsCard, Info, LockKey, MagicWand, ShieldCheck, Sparkle, Stop,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { TgsSticker, type StickerName } from './components/TgsSticker';
import {
  alternateLocale, detectLocale, generatorHref, homeHref, translate,
  type Locale, type MessageKey,
} from './i18n';
import {
  getBrowserConcurrencyPolicy, resolveWorkerCount, type ConcurrencySelection,
} from './lib/concurrency';
import type {
  AddressFormat, ComputeEngine, FoundCandidate, FoundWallet, SearchOptions,
  SearchProgress, WalletVersion, WorkerResponse,
} from './types';

type Screen = 'setup' | 'searching' | 'found' | 'seed-ready' | 'seed';
type CopyTarget = 'address' | 'seed' | null;

const PRESETS = ['GRAM', 'MONEY', 'TON', 'DUCK'];

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
  const [screen, setScreen] = useState<Screen>('setup');
  const [suffix, setSuffix] = useState('GRAM');
  const [version, setVersion] = useState<WalletVersion>('w5');
  const [addressFormat, setAddressFormat] = useState<AddressFormat>('non-bounceable');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [safeToReveal, setSafeToReveal] = useState(false);
  const [concurrencySelection, setConcurrencySelection] = useState<ConcurrencySelection>('auto');
  const [engine, setEngine] = useState<ComputeEngine>('cpu');
  const [activeEngine, setActiveEngine] = useState<ComputeEngine>('cpu');
  const [engineNotice, setEngineNotice] = useState('');
  const [liveMessage, setLiveMessage] = useState('');
  const [gpuAvailable] = useState(() => typeof navigator !== 'undefined' && 'gpu' in navigator);
  const [progress, setProgress] = useState<SearchProgress>({
    attempts: 0, elapsedMs: 0, attemptsPerSecond: 0, sampleAddress: '',
  });
  const [foundCandidate, setFoundCandidate] = useState<FoundCandidate | null>(null);
  const [foundWallet, setFoundWallet] = useState<FoundWallet | null>(null);
  const [error, setError] = useState('');
  const [copyTarget, setCopyTarget] = useState<CopyTarget>(null);
  const [seedVisible, setSeedVisible] = useState(false);
  const [revealPending, setRevealPending] = useState(false);

  const workersRef = useRef<Worker[]>([]);
  const winningWorkerRef = useRef<Worker | null>(null);
  const workerProgressRef = useRef(new Map<number, SearchProgress>());
  const searchStartedAtRef = useRef(0);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const progressAnnouncementRef = useRef(0);

  const cleanSuffix = suffix.trim();
  const workerCount = resolveWorkerCount(concurrencySelection, concurrencyPolicy);
  const searchWorkerCount = engine === 'gpu' ? 1 : workerCount;
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
      ? 'TON Vanity Address Generator — TonSuite'
      : 'TON Vanity Generator — TonSuite';
    const description = isEnglish
      ? 'Generate vanity TON Wallet v4R2 and W5 addresses locally. Address search and recovery phrases stay in your browser.'
      : 'Локальный генератор красивых TON-адресов v4R2 и W5. Перебор и сид-фраза остаются только в вашем браузере.';
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

  const stopWorkers = useCallback(() => {
    workersRef.current.forEach((worker) => { worker.postMessage({ type: 'stop' }); worker.terminate(); });
    workersRef.current = [];
    winningWorkerRef.current = null;
    workerProgressRef.current.clear();
  }, []);

  useEffect(() => stopWorkers, [stopWorkers]);

  useEffect(() => {
    if (screen !== 'searching') return;
    const timer = window.setInterval(() => {
      setProgress((current) => ({ ...current, elapsedMs: Date.now() - searchStartedAtRef.current }));
    }, 250);
    return () => window.clearInterval(timer);
  }, [screen]);

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
    setProgress({
      attempts: values.reduce((sum, item) => sum + item.attempts, 0),
      attemptsPerSecond: values.reduce((sum, item) => sum + item.attemptsPerSecond, 0),
      elapsedMs: Date.now() - searchStartedAtRef.current,
      sampleAddress: latest.sampleAddress,
    });
    const now = Date.now();
    if (now - progressAnnouncementRef.current >= 4_000) {
      setLiveMessage(`${compactNumber(values.reduce((sum, item) => sum + item.attempts, 0), locale)} · ${compactNumber(values.reduce((sum, item) => sum + item.attemptsPerSecond, 0), locale)}/s`);
      progressAnnouncementRef.current = now;
    }
  }, [locale]);

  const startSearch = useCallback(() => {
    if (suffixError || (engine === 'gpu' && !gpuAvailable)) return;
    stopWorkers();
    setError(''); setEngineNotice(''); setActiveEngine(engine);
    setLiveMessage(t('search.running'));
    progressAnnouncementRef.current = Date.now();
    setFoundCandidate(null); setFoundWallet(null); setRevealPending(false);
    setSeedVisible(false); setCopyTarget(null);
    setProgress({ attempts: 0, elapsedMs: 0, attemptsPerSecond: 0, sampleAddress: '' });
    searchStartedAtRef.current = Date.now();
    setScreen('searching');

    const options: SearchOptions = {
      suffix: cleanSuffix, version, addressFormat, caseSensitive, engine, locale,
    };

    const nextWorkers = Array.from({ length: searchWorkerCount }, (_, workerId) => {
      const worker = new Worker(new URL('./workers/vanity.worker.ts', import.meta.url), {
        type: 'module', name: `ton-vanity-${engine}-${workerId}`,
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'engine') {
          setActiveEngine(message.engine);
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
          const totalAttempts = [...workerProgressRef.current.values()].reduce((sum, item) => sum + item.attempts, 0);
          setFoundCandidate({ ...message.candidate, attempts: totalAttempts, elapsedMs: Date.now() - searchStartedAtRef.current });
          setLiveMessage(t('found.status'));
          workersRef.current.forEach((otherWorker) => {
            if (otherWorker !== worker) { otherWorker.postMessage({ type: 'stop' }); otherWorker.terminate(); }
          });
          workersRef.current = [worker];
          setScreen('found');
        }
        if (message.type === 'revealed') {
          setFoundWallet(message.wallet); setSeedVisible(true); setRevealPending(false);
          setLiveMessage(t('seed.title'));
          setScreen('seed'); stopWorkers();
        }
        if (message.type === 'error') {
          setError(message.message || t('error.generator')); setScreen('setup'); stopWorkers();
        }
      };
      worker.onerror = () => { setError(t('error.generator')); setScreen('setup'); stopWorkers(); };
      worker.postMessage({ type: 'start', options, workerId });
      return worker;
    });
    workersRef.current = nextWorkers;
  }, [addressFormat, aggregateProgress, caseSensitive, cleanSuffix, engine,
    gpuAvailable, locale, searchWorkerCount, stopWorkers, suffixError, t, version]);

  const cancelSearch = () => { stopWorkers(); setScreen('setup'); };
  const goBack = () => {
    if (screen === 'searching') cancelSearch();
    else if (screen === 'seed-ready') setScreen('found');
    else if (screen === 'seed') setSeedVisible(false);
    else reset();
  };
  const reset = () => {
    stopWorkers(); setFoundCandidate(null); setFoundWallet(null); setRevealPending(false);
    setSafeToReveal(false); setSeedVisible(false); setCopyTarget(null); setError('');
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
    window.history.pushState(null, '', generatorHref(nextLocale));
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

  const setupScreen = (
    <>
      <ScreenSticker screen="setup" locale={locale} />
      <div className="hero-copy"><StatusPill locale={locale} /><h1 tabIndex={-1}>{t('setup.title')}</h1><p>{t('setup.description')}</p></div>
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
          <div className="segmented" role="group" aria-label={t('wallet.group')}>
            <button type="button" aria-pressed={version === 'w5'}
              className={version === 'w5' ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => setVersion('w5')}>W5 <span>{t('wallet.recommended')}</span></button>
            <button type="button" aria-pressed={version === 'v4r2'}
              className={version === 'v4r2' ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => setVersion('v4r2')}>v4R2 <span>{t('wallet.compatibility')}</span></button>
          </div>
        </div>

        <details className="advanced-settings">
          <summary>{t('advanced.title')}</summary>
          <div className="advanced-settings__body">
            <div className="advanced-group">
              <div className="setting-heading">
                <span className="setting-icon setting-icon--orange"><GraphicsCard weight="fill" /></span>
                <span><strong>{t('compute.title')}</strong><small>{t('compute.description')}</small></span>
              </div>
              <div className="engine-grid" role="group" aria-label={t('compute.title')}>
                <button type="button" aria-pressed={engine === 'cpu'}
                  className={engine === 'cpu' ? 'engine-card is-active' : 'engine-card'} onClick={() => setEngine('cpu')}>
                  <Cpu weight="fill" /><span><strong>{t('compute.cpu')}</strong><small>{t('compute.cpuDescription')}</small></span>
                </button>
                <button type="button" aria-pressed={engine === 'gpu'} disabled={!gpuAvailable}
                  className={engine === 'gpu' ? 'engine-card is-active' : 'engine-card'} onClick={() => setEngine('gpu')}>
                  <GraphicsCard weight="fill" /><span><strong>{t('compute.gpu')}</strong><small>{gpuAvailable ? t('compute.gpuDescription') : t('compute.gpuUnavailable')}</small></span>
                </button>
              </div>
            </div>

            <label className={`select-row ${engine === 'gpu' ? 'is-muted' : ''}`}>
              <span className="setting-icon setting-icon--green"><Cpu weight="fill" /></span>
              <span className="toggle-copy"><strong>{t('threads.title')}</strong><small>{t('threads.description')}</small></span>
              <select value={String(concurrencySelection)} disabled={engine === 'gpu'} onChange={(event) => {
                const value = event.target.value;
                setConcurrencySelection(value === 'auto' || value === 'maximum' ? value : Number(value));
              }}>
                <option value="auto">{t('threads.auto', { count: concurrencyPolicy.autoWorkerCount })}</option>
                <option value="maximum">{t('threads.maximum', { count: concurrencyPolicy.maximumWorkerCount })}</option>
                {Array.from({ length: concurrencyPolicy.maximumWorkerCount }, (_, index) => index + 1).map((count) =>
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
                <label><input type="radio" name="address-format" checked={addressFormat === 'non-bounceable'} onChange={() => setAddressFormat('non-bounceable')} />
                  <span><strong>UQ…</strong><small>{t('format.nonBounceable')}</small></span></label>
                <label><input type="radio" name="address-format" checked={addressFormat === 'bounceable'} onChange={() => setAddressFormat('bounceable')} />
                  <span><strong>EQ…</strong><small>{t('format.bounceable')}</small></span></label>
              </div>
            </div>
          </div>
        </details>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      <button type="button" className="primary-button"
        disabled={Boolean(suffixError) || (engine === 'gpu' && !gpuAvailable)} onClick={startSearch}>
        <MagicWand weight="bold" /> {t('action.start')}
      </button>
      <p className="privacy-note"><LockKey weight="fill" /> {t('privacy.localCompute')}</p>
    </>
  );

  const engineLabel = activeEngine === 'gpu' ? t('engine.gpu') : t('engine.cpu', { count: searchWorkerCount });
  const searchingScreen = (
    <>
      <ScreenSticker screen="searching" locale={locale} />
      <div className="hero-copy"><StatusPill locale={locale} /><h1 tabIndex={-1}>{t('search.title')}</h1>
        <p>{t('search.description', { suffix: cleanSuffix, version: version === 'w5' ? 'W5' : 'v4R2', engine: engineLabel })}</p></div>
      {engineNotice && <div className="notice-banner" role="status">{engineNotice}</div>}
      <section className="panel progress-panel">
        <div className="pulse-orbit" aria-hidden="true"><span /></div>
        <div className="live-label"><span /> {t('search.running')}</div>
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
      <button type="button" className="secondary-button danger-button" onClick={cancelSearch}><Stop weight="fill" /> {t('search.stop')}</button>
    </>
  );

  const foundScreen = foundCandidate && (
    <>
      <ScreenSticker screen="found" locale={locale} />
      <div className="hero-copy"><span className="success-pill"><CheckCircle weight="fill" /> {t('found.status')}</span>
        <h1 tabIndex={-1}>{t('found.title')}</h1><p>{t('found.description')}</p></div>
      <section className="panel found-panel">
        <div className="wallet-meta"><span>TON {foundCandidate.version === 'w5' ? 'W5' : 'v4R2'}</span>
          <span>{foundCandidate.addressFormat === 'bounceable' ? 'Bounceable' : 'Non-bounceable'}</span></div>
        <div className="found-address"><HighlightedAddress address={foundCandidate.address} suffix={cleanSuffix} />
          <button type="button" className="icon-button" aria-label={t('found.copyAddress')}
            onClick={() => void copyText(foundCandidate.address, 'address')}>
            {copyTarget === 'address' ? <Check weight="bold" /> : <Copy weight="bold" />}</button></div>
        <div className="found-stats"><span><small>{t('found.attempts')}</small><strong>{compactNumber(foundCandidate.attempts, locale)}</strong></span>
          <span><small>{t('found.time')}</small><strong>{formatDuration(foundCandidate.elapsedMs)}</strong></span></div>
      </section>
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
        <h1 tabIndex={-1}>{t('seedReady.title')}</h1><p>{t('seedReady.description')}</p></div>
      <div className="seed-warning"><ShieldCheck weight="fill" />
        <span><strong>{t('seed.warningTitle')}</strong><small>{t('seed.warningDescription')}</small></span></div>
      <label className="consent-card">
        <input type="checkbox" checked={safeToReveal} onChange={(event) => setSafeToReveal(event.target.checked)} />
        <span className="checkmark"><Check weight="bold" /></span>
        <span><strong>{t('seedReady.check')}</strong><small>{t('seedReady.checkDescription')}</small></span>
      </label>
      <button type="button" className="primary-button" disabled={!safeToReveal || revealPending} onClick={revealSeed}>
        {revealPending ? t('found.revealPending') : t('seedReady.reveal')}</button>
      <button type="button" className="text-button" onClick={() => setScreen('found')}>{t('seedReady.back')}</button>
    </>
  );

  const seedScreen = foundWallet && (
    <>
      <ScreenSticker screen="seed" locale={locale} />
      <div className="hero-copy"><span className="secret-pill"><LockKey weight="fill" /> {t('seed.status')}</span>
        <h1 tabIndex={-1}>{t('seed.title')}</h1><p>{t('seed.description')}</p></div>
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
        ) : <div className="seed-hidden-state"><EyeSlash weight="fill" />{t('seed.hidden')}</div>}
        <div className="seed-standard"><span>BIP39 · SLIP-0010</span><code>m/44&apos;/607&apos;/0&apos;</code></div>
        <button type="button" className="copy-seed-button" disabled={!seedVisible}
          onClick={() => void copyText(foundWallet.mnemonic.join(' '), 'seed')}>
          {copyTarget === 'seed' ? <Check weight="bold" /> : <Copy weight="bold" />}
          {copyTarget === 'seed' ? t('seed.copied') : t('seed.copy')}</button>
      </section>
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
          {screen !== 'setup' && screen !== 'seed' && <button type="button" className="back-button"
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
      <main id="generator-main" className={`generator generator--${screen}`}>
        {screen === 'setup' && setupScreen}{screen === 'searching' && searchingScreen}
        {screen === 'found' && foundScreen}{screen === 'seed-ready' && seedReadyScreen}{screen === 'seed' && seedScreen}
      </main>
      <footer><span>© {new Date().getFullYear()} TonSuite</span>
        <a href={locale === 'ru' ? '/privacy/' : '/en/privacy/'}>{t('footer.privacy')}</a>
        <a href="https://t.me/addstickers/UtyaDuck" target="_blank" rel="noreferrer">{t('footer.utya')}</a></footer>
    </div>
  );
}
