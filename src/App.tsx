import {
  ArrowLeft,
  Check,
  CheckCircle,
  Copy,
  Cpu,
  Eye,
  EyeSlash,
  GithubLogo,
  Info,
  LockKey,
  MagicWand,
  ShieldCheck,
  Sparkle,
  Stop,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TgsSticker, type StickerName } from './components/TgsSticker';
import type {
  AddressFormat,
  FoundCandidate,
  FoundWallet,
  SearchOptions,
  SearchProgress,
  WalletVersion,
  WorkerResponse,
} from './types';

type Screen = 'setup' | 'searching' | 'found' | 'seed';
type CopyTarget = 'address' | 'seed' | null;

const PRESETS = ['GRAM', 'MONEY', 'TON', 'DUCK', 'DICK'];
const MAX_WORKERS = 8;

function availableWorkers() {
  const hardware = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(MAX_WORKERS, hardware - 1));
}

function expectedAttempts(suffix: string, caseSensitive: boolean) {
  if (!suffix) return 0;
  if (caseSensitive) return 64 ** suffix.length;
  const letters = [...suffix].filter((character) => /[a-z]/i.test(character)).length;
  return 64 ** suffix.length / 2 ** letters;
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return '∞';
  return new Intl.NumberFormat('ru-RU', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Math.round(value));
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatEta(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Измеряем…';
  const hours = milliseconds / 3_600_000;
  if (hours < 1) return `≈ ${Math.max(1, Math.round(milliseconds / 60_000))} мин`;
  if (hours < 48) return `≈ ${Math.round(hours)} ч`;
  const days = hours / 24;
  if (days < 730) return `≈ ${Math.round(days)} дн`;
  return `≈ ${Math.round(days / 365)} лет`;
}

function estimateLabel(attempts: number) {
  if (!attempts) return 'Введите окончание';
  if (attempts < 1_000) return `≈ ${compactNumber(attempts)} попыток`;
  if (attempts < 100_000_000) return `≈ ${compactNumber(attempts)} попыток — реально`;
  if (attempts < 10_000_000_000) return `≈ ${compactNumber(attempts)} попыток — надолго`;
  return `≈ ${compactNumber(attempts)} попыток — очень надолго`;
}

function TonSuiteMark() {
  return (
    <a className="brand" href="/" aria-label="На главную TonSuite">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 28 28" focusable="false">
          <path d="M5.8 7.4h16.4L14 22 5.8 7.4Z" />
          <path className="brand__cut" d="m14 18.3 3.7-7.5h-7.4l3.7 7.5Z" />
        </svg>
      </span>
      <span>TonSuite</span>
    </a>
  );
}

function StatusPill() {
  return (
    <span className="local-pill">
      <span className="local-pill__dot" />
      100% локально
    </span>
  );
}

function ScreenSticker({ screen }: { screen: Screen }) {
  const stickers: Record<Screen, { name: StickerName; label: string }> = {
    setup: { name: 'thinking', label: 'Утя выбирает красивое окончание' },
    searching: { name: 'hunting', label: 'Утя охотится за адресом' },
    found: { name: 'success', label: 'Утя празднует найденный адрес' },
    seed: { name: 'secret', label: 'Утя хранит секрет' },
  };
  return <TgsSticker {...stickers[screen]} />;
}

function HighlightedAddress({ address, suffix }: { address: string; suffix: string }) {
  const prefix = address.slice(0, Math.max(0, address.length - suffix.length));
  const ending = address.slice(-suffix.length);
  return (
    <span className="address-text">
      {prefix}
      <strong>{ending}</strong>
    </span>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [suffix, setSuffix] = useState('GRAM');
  const [version, setVersion] = useState<WalletVersion>('w5');
  const [addressFormat, setAddressFormat] = useState<AddressFormat>('non-bounceable');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [confirmedLocal, setConfirmedLocal] = useState(false);
  const [workerCount, setWorkerCount] = useState(() => Math.min(4, availableWorkers()));
  const [progress, setProgress] = useState<SearchProgress>({
    attempts: 0,
    elapsedMs: 0,
    attemptsPerSecond: 0,
    sampleAddress: '',
  });
  const [foundCandidate, setFoundCandidate] = useState<FoundCandidate | null>(null);
  const [foundWallet, setFoundWallet] = useState<FoundWallet | null>(null);
  const [error, setError] = useState('');
  const [copyTarget, setCopyTarget] = useState<CopyTarget>(null);
  const [seedVisible, setSeedVisible] = useState(true);
  const [revealPending, setRevealPending] = useState(false);

  const workersRef = useRef<Worker[]>([]);
  const winningWorkerRef = useRef<Worker | null>(null);
  const workerProgressRef = useRef(new Map<number, SearchProgress>());
  const searchStartedAtRef = useRef(0);
  const copyTimerRef = useRef<number | undefined>(undefined);

  const cleanSuffix = suffix.trim();
  const suffixError = useMemo(() => {
    if (!cleanSuffix) return 'Введите хотя бы один символ';
    if (!/^[A-Za-z0-9_-]+$/.test(cleanSuffix)) {
      return 'Допустимы A–Z, a–z, 0–9, _ и -';
    }
    if (cleanSuffix.length > 8) return 'До 8 символов — дальше ожидание практически бесконечно';
    return '';
  }, [cleanSuffix]);
  const attemptsEstimate = useMemo(
    () => expectedAttempts(cleanSuffix, caseSensitive),
    [caseSensitive, cleanSuffix],
  );

  const stopWorkers = useCallback(() => {
    workersRef.current.forEach((worker) => {
      worker.postMessage({ type: 'stop' });
      worker.terminate();
    });
    workersRef.current = [];
    winningWorkerRef.current = null;
    workerProgressRef.current.clear();
  }, []);

  useEffect(() => stopWorkers, [stopWorkers]);

  useEffect(() => {
    if (screen !== 'searching') return;
    const timer = window.setInterval(() => {
      setProgress((current) => ({
        ...current,
        elapsedMs: Date.now() - searchStartedAtRef.current,
      }));
    }, 250);
    return () => window.clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (screen !== 'found' && screen !== 'seed') return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [screen]);

  const aggregateProgress = useCallback(() => {
    const values = [...workerProgressRef.current.values()];
    if (!values.length) return;
    const latest = values.reduce((left, right) =>
      right.elapsedMs > left.elapsedMs ? right : left,
    );
    setProgress({
      attempts: values.reduce((sum, item) => sum + item.attempts, 0),
      attemptsPerSecond: values.reduce((sum, item) => sum + item.attemptsPerSecond, 0),
      elapsedMs: Date.now() - searchStartedAtRef.current,
      sampleAddress: latest.sampleAddress,
    });
  }, []);

  const startSearch = useCallback(() => {
    if (suffixError || !confirmedLocal) return;
    stopWorkers();
    setError('');
    setFoundCandidate(null);
    setFoundWallet(null);
    setRevealPending(false);
    setCopyTarget(null);
    setProgress({ attempts: 0, elapsedMs: 0, attemptsPerSecond: 0, sampleAddress: '' });
    searchStartedAtRef.current = Date.now();
    setScreen('searching');

    const options: SearchOptions = {
      suffix: cleanSuffix,
      version,
      addressFormat,
      caseSensitive,
    };

    const nextWorkers = Array.from({ length: workerCount }, (_, workerId) => {
      const worker = new Worker(new URL('./workers/vanity.worker.ts', import.meta.url), {
        type: 'module',
        name: `ton-vanity-${workerId}`,
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'progress') {
          workerProgressRef.current.set(message.workerId, message.progress);
          aggregateProgress();
        }
        if (message.type === 'candidate') {
          if (winningWorkerRef.current && winningWorkerRef.current !== worker) {
            worker.postMessage({ type: 'stop' });
            worker.terminate();
            return;
          }
          winningWorkerRef.current = worker;
          workerProgressRef.current.set(message.workerId, {
            attempts: message.candidate.attempts,
            attemptsPerSecond: 0,
            elapsedMs: message.candidate.elapsedMs,
            sampleAddress: message.candidate.address,
          });
          const totalAttempts = [...workerProgressRef.current.values()].reduce(
            (sum, item) => sum + item.attempts,
            0,
          );
          setFoundCandidate({
            ...message.candidate,
            attempts: totalAttempts,
            elapsedMs: Date.now() - searchStartedAtRef.current,
          });
          workersRef.current.forEach((otherWorker) => {
            if (otherWorker !== worker) {
              otherWorker.postMessage({ type: 'stop' });
              otherWorker.terminate();
            }
          });
          workersRef.current = [worker];
          setScreen('found');
        }
        if (message.type === 'revealed') {
          setFoundWallet(message.wallet);
          setRevealPending(false);
          setScreen('seed');
          stopWorkers();
        }
        if (message.type === 'error') {
          setError(message.message);
          setScreen('setup');
          stopWorkers();
        }
      };
      worker.onerror = () => {
        setError('Не удалось запустить локальный генератор. Обновите страницу или браузер.');
        setScreen('setup');
        stopWorkers();
      };
      worker.postMessage({ type: 'start', options, workerId });
      return worker;
    });

    workersRef.current = nextWorkers;
  }, [
    addressFormat,
    aggregateProgress,
    caseSensitive,
    cleanSuffix,
    confirmedLocal,
    stopWorkers,
    suffixError,
    version,
    workerCount,
  ]);

  const cancelSearch = () => {
    stopWorkers();
    setScreen('setup');
  };

  const reset = () => {
    stopWorkers();
    setFoundCandidate(null);
    setFoundWallet(null);
    setRevealPending(false);
    setSeedVisible(true);
    setCopyTarget(null);
    setScreen('setup');
  };

  const revealSeed = () => {
    const winningWorker = winningWorkerRef.current;
    if (!winningWorker) {
      setError('Найденный кошелёк уже недоступен. Запустите поиск заново.');
      reset();
      return;
    }
    setRevealPending(true);
    winningWorker.postMessage({ type: 'reveal' });
  };

  const copyText = async (text: string, target: Exclude<CopyTarget, null>) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyTarget(target);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopyTarget(null), 1800);
    } catch {
      setError('Браузер не дал доступ к буферу обмена. Скопируйте вручную.');
    }
  };

  const setupScreen = (
    <>
      <ScreenSticker screen="setup" />
      <div className="hero-copy">
        <StatusPill />
        <h1>Поймай красивый TON-адрес</h1>
        <p>Утя перебирает кошельки прямо на вашем устройстве. Адреса и сид-фразы никуда не отправляются.</p>
      </div>

      <section className="panel setup-panel" aria-labelledby="settings-title">
        <h2 id="settings-title" className="sr-only">Настройки генератора</h2>

        <label className="field-label" htmlFor="suffix">Окончание адреса</label>
        <div className={`suffix-field ${suffixError && suffix ? 'suffix-field--error' : ''}`}>
          <span>…</span>
          <input
            id="suffix"
            value={suffix}
            onChange={(event) => setSuffix(event.target.value.replace(/\s/g, '').slice(0, 8))}
            placeholder="GRAM"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="suffix-hint"
            aria-invalid={Boolean(suffixError)}
          />
          <span className="character-count">{cleanSuffix.length}/8</span>
        </div>
        <div id="suffix-hint" className={`field-hint ${suffixError ? 'field-hint--error' : ''}`}>
          {suffixError || estimateLabel(attemptsEstimate)}
        </div>

        <div className="preset-row" aria-label="Примеры окончаний">
          {PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              className={cleanSuffix === preset ? 'chip chip--active' : 'chip'}
              onClick={() => setSuffix(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="setting-block">
          <div className="setting-heading">
            <span className="setting-icon setting-icon--blue"><Sparkle weight="fill" /></span>
            <span>
              <strong>Версия кошелька</strong>
              <small>Совместима с TON-кошельками</small>
            </span>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Версия кошелька">
            <button
              type="button"
              role="radio"
              aria-checked={version === 'w5'}
              className={version === 'w5' ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => setVersion('w5')}
            >
              W5 <span>Рекомендуется</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={version === 'v4r2'}
              className={version === 'v4r2' ? 'segmented__item is-active' : 'segmented__item'}
              onClick={() => setVersion('v4r2')}
            >
              v4R2 <span>Совместимость</span>
            </button>
          </div>
        </div>

        <div className="setting-block compact-settings">
          <label className="toggle-row">
            <span className="setting-icon setting-icon--violet"><MagicWand weight="fill" /></span>
            <span className="toggle-copy">
              <strong>Учитывать регистр</strong>
              <small>{caseSensitive ? 'Точное совпадение: сложнее' : 'MONEY совпадёт с money'}</small>
            </span>
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(event) => setCaseSensitive(event.target.checked)}
            />
            <span className="toggle" aria-hidden="true" />
          </label>

          <label className="select-row">
            <span className="setting-icon setting-icon--green"><Cpu weight="fill" /></span>
            <span className="toggle-copy">
              <strong>Потоки</strong>
              <small>Чем больше, тем выше нагрузка</small>
            </span>
            <select value={workerCount} onChange={(event) => setWorkerCount(Number(event.target.value))}>
              {Array.from({ length: availableWorkers() }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </label>
        </div>

        <details className="advanced-settings">
          <summary>Формат адреса</summary>
          <div className="radio-stack">
            <label>
              <input
                type="radio"
                name="address-format"
                checked={addressFormat === 'non-bounceable'}
                onChange={() => setAddressFormat('non-bounceable')}
              />
              <span><strong>UQ…</strong><small>Non-bounceable · удобно для получения</small></span>
            </label>
            <label>
              <input
                type="radio"
                name="address-format"
                checked={addressFormat === 'bounceable'}
                onChange={() => setAddressFormat('bounceable')}
              />
              <span><strong>EQ…</strong><small>Bounceable · стандартный формат</small></span>
            </label>
          </div>
        </details>
      </section>

      <label className="consent-card">
        <input
          type="checkbox"
          checked={confirmedLocal}
          onChange={(event) => setConfirmedLocal(event.target.checked)}
        />
        <span className="checkmark"><Check weight="bold" /></span>
        <span>
          <strong>Я понимаю, как сохранить кошелёк</strong>
          <small>Если закрыть вкладку до сохранения 12 слов, восстановить найденный кошелёк будет невозможно.</small>
        </span>
      </label>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <button
        type="button"
        className="primary-button"
        disabled={Boolean(suffixError) || !confirmedLocal}
        onClick={startSearch}
      >
        <MagicWand weight="bold" /> Начать охоту
      </button>
      <p className="privacy-note"><LockKey weight="fill" /> Интернет после загрузки не нужен</p>
    </>
  );

  const searchingScreen = (
    <>
      <ScreenSticker screen="searching" />
      <div className="hero-copy">
        <StatusPill />
        <h1>Утя уже охотится</h1>
        <p>Ищем <strong>…{cleanSuffix}</strong> в {version === 'w5' ? 'W5' : 'v4R2'}-адресах, {workerCount} {workerCount === 1 ? 'поток' : workerCount < 5 ? 'потока' : 'потоков'}. Можно оставить вкладку открытой.</p>
      </div>

      <section className="panel progress-panel" aria-live="polite">
        <div className="pulse-orbit" aria-hidden="true"><span /></div>
        <div className="live-label"><span /> Перебор идёт</div>
        <div className="attempts-number">{compactNumber(progress.attempts)}</div>
        <div className="attempts-caption">попыток проверено</div>

        <div className="stats-grid">
          <div><small>Скорость</small><strong>{compactNumber(progress.attemptsPerSecond)}/с</strong></div>
          <div><small>Время</small><strong>{formatDuration(progress.elapsedMs)}</strong></div>
          <div><small>Ориентир</small><strong>{formatEta((attemptsEstimate / progress.attemptsPerSecond) * 1_000)}</strong></div>
        </div>

        <div className="sample-address">
          <small>Последний кандидат</small>
          <span>{progress.sampleAddress || 'Готовим генератор…'}</span>
        </div>
      </section>

      <div className="probability-note">
        <Info weight="fill" />
        <span>Поиск случайный. Ожидание может оказаться короче или длиннее расчёта.</span>
      </div>

      <button type="button" className="secondary-button danger-button" onClick={cancelSearch}>
        <Stop weight="fill" /> Остановить
      </button>
    </>
  );

  const foundScreen = foundCandidate && (
    <>
      <ScreenSticker screen="found" />
      <div className="hero-copy">
        <span className="success-pill"><CheckCircle weight="fill" /> Найдено</span>
        <h1>Вот это адрес!</h1>
        <p>Утя нашёл нужное окончание. Проверьте адрес, прежде чем сохранить кошелёк.</p>
      </div>

      <section className="panel found-panel">
        <div className="wallet-meta">
          <span>TON {foundCandidate.version === 'w5' ? 'W5' : 'v4R2'}</span>
          <span>{foundCandidate.addressFormat === 'bounceable' ? 'Bounceable' : 'Non-bounceable'}</span>
        </div>
        <div className="found-address">
          <HighlightedAddress address={foundCandidate.address} suffix={cleanSuffix} />
          <button
            type="button"
            className="icon-button"
            aria-label="Скопировать адрес"
            onClick={() => void copyText(foundCandidate.address, 'address')}
          >
            {copyTarget === 'address' ? <Check weight="bold" /> : <Copy weight="bold" />}
          </button>
        </div>
        <div className="found-stats">
          <span><small>Попыток</small><strong>{compactNumber(foundCandidate.attempts)}</strong></span>
          <span><small>Время</small><strong>{formatDuration(foundCandidate.elapsedMs)}</strong></span>
        </div>
      </section>

      <div className="warning-card">
        <ShieldCheck weight="fill" />
        <span><strong>Сид пока скрыт</strong><small>Он существует только в памяти этой вкладки и исчезнет после закрытия.</small></span>
      </div>

      <button type="button" className="primary-button" disabled={revealPending} onClick={revealSeed}>
        {revealPending ? 'Готовим сид-фразу…' : 'Да, сохранить этот кошелёк'}
      </button>
      <button type="button" className="text-button" onClick={reset}>Искать другой адрес</button>
    </>
  );

  const seedScreen = foundWallet && (
    <>
      <ScreenSticker screen="seed" />
      <div className="hero-copy">
        <span className="secret-pill"><LockKey weight="fill" /> Только для вас</span>
        <h1>Сохраните 12 слов</h1>
        <p>Это единственный ключ к кошельку. Запишите слова по порядку и храните офлайн.</p>
      </div>

      <div className="seed-warning">
        <ShieldCheck weight="fill" />
        <span><strong>Никому не показывайте сид-фразу</strong><small>TonSuite никогда не попросит эти слова в чате, боте или поддержке.</small></span>
      </div>

      <section className={`panel seed-panel ${seedVisible ? '' : 'seed-panel--hidden'}`}>
        <div className="seed-toolbar">
          <span>Секретная фраза</span>
          <button type="button" onClick={() => setSeedVisible((value) => !value)}>
            {seedVisible ? <EyeSlash /> : <Eye />} {seedVisible ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        <ol className="seed-grid">
          {foundWallet.mnemonic.map((word, index) => (
            <li key={`${word}-${index}`}><span>{index + 1}</span><strong>{word}</strong></li>
          ))}
        </ol>
        <div className="seed-standard">
          <span>BIP39 · TEP-3</span>
          <code>m/44&apos;/607&apos;/0&apos;</code>
        </div>
        <button
          type="button"
          className="copy-seed-button"
          onClick={() => void copyText(foundWallet.mnemonic.join(' '), 'seed')}
        >
          {copyTarget === 'seed' ? <Check weight="bold" /> : <Copy weight="bold" />}
          {copyTarget === 'seed' ? 'Скопировано' : 'Скопировать 12 слов'}
        </button>
      </section>

      <button type="button" className="primary-button" onClick={reset}>Я сохранил — начать заново</button>
      <p className="privacy-note"><LockKey weight="fill" /> Фраза не сохраняется в браузере</p>
    </>
  );

  return (
    <div className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <header className="topbar">
        {screen === 'setup' ? <TonSuiteMark /> : (
          <button
            type="button"
            className="back-button"
            onClick={screen === 'searching' ? cancelSearch : reset}
            aria-label="Назад"
          >
            <ArrowLeft weight="bold" />
          </button>
        )}
        <a
          className="github-link"
          href="https://github.com/rub1kub/ton-vanity-generator"
          target="_blank"
          rel="noreferrer"
        >
          <GithubLogo weight="fill" /> <span>Open source</span>
        </a>
      </header>

      <main className={`generator generator--${screen}`}>
        {screen === 'setup' && setupScreen}
        {screen === 'searching' && searchingScreen}
        {screen === 'found' && foundScreen}
        {screen === 'seed' && seedScreen}
      </main>

      <footer>
        <span>© {new Date().getFullYear()} TonSuite</span>
        <a href="/privacy/">Конфиденциальность</a>
        <a href="https://t.me/addstickers/UtyaDuck" target="_blank" rel="noreferrer">Утя</a>
      </footer>
    </div>
  );
}
