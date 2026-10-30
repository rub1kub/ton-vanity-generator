import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, Eye, EyeSlash, LockKey, TelegramLogo } from '@phosphor-icons/react';
import type { Locale } from '../i18n';
import { RotationClient } from '../lib/tg-rotation-client';
import { RotationError } from '../lib/tg-rotation-types';
import type { PendingRotation, RotationErrorCode, RotationPreview, RotationStatus } from '../lib/tg-rotation-types';
import { clearPendingRotation, loadPendingRotation, ROTATION_JOURNAL_KEY, savePendingRotation } from '../lib/tg-rotation-journal';
import './telegram-rotation.css';

const errors: Record<RotationErrorCode, [string, string]> = {
  phrase: ['Проверьте слова и их порядок: нужны 12 слов tgWallet или 24 слова в формате 12 + 12.', 'Check the words and their order: use 12 WalletTg words or 24 words in the 12 + 12 format.'],
  address: ['Нужен адрес основной сети TON, workchain 0.', 'Enter a TON mainnet address in workchain 0.'],
  mismatch: ['Первые 12 слов не соответствуют этому адресу.', 'The first 12 words do not match this address.'],
  staleKey: ['Эта фраза больше не управляет кошельком. Нужна актуальная фраза с текущим ключом.', 'This phrase no longer controls the wallet. Use the current recovery phrase.'],
  wallet: ['Адрес не является поддерживаемым WalletTg rev00 или его состояние не допускает смену ключа.', 'This is not a supported WalletTg rev00 account, or its state does not allow rotation.'],
  configuration: ['Версия WalletTg в сети изменилась. Смена ключа остановлена до обновления поддержки.', 'The network WalletTg implementation changed. Rotation is stopped until support is updated.'],
  network: ['Нет достоверного ответа сети. Проверьте подключение и повторите проверку.', 'No reliable network response. Check your connection and check again.'],
  rateLimit: ['TON Center ограничил частоту запросов. Подождите и повторите проверку.', 'TON Center rate limit reached. Wait, then check again.'],
  clock: ['Время устройства или данные узла устарели. Проверьте часы и повторите позже.', 'The device clock or node data is out of sync. Check your clock and retry later.'],
  balance: ['Недостаточно TON для комиссии и резерва. Пополните этот адрес примерно на 0,05 TON и повторите проверку.', 'Not enough TON for fees and reserve. Fund this address with about 0.05 TON, then check again.'],
  estimate: ['Не удалось оценить комиссию. Операция не подписана; повторите проверку позже.', 'Fee estimation failed. The operation was not signed; check again later.'],
  stateChanged: ['Состояние кошелька изменилось. Вернитесь назад и заново проверьте адрес.', 'The wallet state changed. Go back and check the address again.'],
  feeChanged: ['Оценка комиссии выросла. Вернитесь назад для новой оценки и нового подтверждения.', 'The fee estimate increased. Go back for a new estimate and confirmation.'],
  storage: ['Не удалось прочитать или сохранить журнал операции. Разрешите Local Storage для этого сайта. Не удаляйте данные незавершённой смены.', 'Cannot read or save the operation journal. Allow Local Storage for this site. Do not delete an unresolved rotation.'],
  busy: ['Есть другая незавершённая операция или открыта другая вкладка смены ключа. Проверьте её результат.', 'Another operation is unresolved, or another tab is signing. Check its result first.'],
  internal: ['Не удалось выполнить операцию в браузере. Сохраните обе фразы; после перезагрузки проверьте результат.', 'The browser could not complete the operation. Keep both phrases; reload to check its result.'],
};

function formatTon(value: string) {
  const n = BigInt(value);
  return `${n / 1_000_000_000n}.${(n % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '') || '0'}`;
}

export function TelegramRotation({ locale, initialAddress = '', onClose }: {
  locale: Locale; initialAddress?: string; onClose: (completed?: boolean) => void;
}) {
  const ru = locale === 'ru';
  const text = (r: string, en: string) => ru ? r : en;
  const client = useRef<RotationClient | null>(null);
  const getClient = () => client.current ?? (client.current = new RotationClient());
  const [address, setAddress] = useState(initialAddress);
  const [phrase, setPhrase] = useState('');
  const [preview, setPreview] = useState<RotationPreview | null>(null);
  const [pending, setPending] = useState<PendingRotation | null>(null);
  const [status, setStatus] = useState<RotationStatus>('pending');
  const [error, setError] = useState<RotationErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState(['', '', '']);
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const mounted = useRef(true);
  const pendingRef = useRef<PendingRotation | null>(null);
  pendingRef.current = pending;
  const fail = (error: unknown) => setError(error instanceof RotationError ? error.code : 'internal');

  useEffect(() => {
    mounted.current = true;
    const restore = () => {
      try {
        const journal = loadPendingRotation();
        if (journal && journal.messageHash !== pendingRef.current?.messageHash) {
          setPending(journal); setStatus('pending'); setPhrase(''); setVisible(false);
          setPreview((old) => { old?.words.fill(''); return null; });
        }
        setReady(true);
      } catch (error) { fail(error); }
    };
    restore();
    const onStorage = (event: StorageEvent) => { if (event.key === ROTATION_JOURNAL_KEY) restore(); };
    window.addEventListener('storage', onStorage);
    return () => {
      mounted.current = false;
      window.removeEventListener('storage', onStorage);
      client.current?.dispose(); client.current = null;
    };
  }, []);

  const check = async (operation: PendingRotation) => {
    if (checkingRef.current) return;
    checkingRef.current = true; setChecking(true);
    try {
      const result = await getClient().request<RotationStatus>({ action: 'status', pending: operation });
      if (mounted.current) { setStatus(result); setError(null); }
    } catch (error) { if (mounted.current) fail(error); }
    finally { checkingRef.current = false; if (mounted.current) setChecking(false); }
  };

  useEffect(() => {
    if (!pending || status !== 'pending' || busy) return;
    void check(pending);
    const interval = setInterval(() => void check(pending), 8000);
    return () => clearInterval(interval);
    // The same pending operation is checked after reload, without any seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, status, busy]);

  useEffect(() => {
    if (!pending || status === 'confirmed' || status === 'expired' || status === 'superseded') return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [pending, status]);

  const prepare = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (loadPendingRotation()) throw new RotationError('busy');
      const result = await getClient().request<RotationPreview>({ action: 'prepare', phrase, address });
      if (!mounted.current) return;
      if (loadPendingRotation()) { result.words.fill(''); throw new RotationError('busy'); }
      setPhrase(''); setPreview(result); setAnswers(['', '', '']); setSaved(false); setSeen(false); setVisible(false);
    } catch (error) { if (mounted.current) fail(error); }
    finally { if (mounted.current) setBusy(false); }
  };

  const quizValid = !!preview && preview.quiz.every((position, i) => answers[i].trim().toLowerCase() === preview.words[position]);
  const submit = async () => {
    if (busy || !preview || !saved || !seen || visible || !quizValid) return;
    setBusy(true); setError(null);
    try {
      if (!navigator.locks) throw new RotationError('busy');
      await navigator.locks.request('tonsuite-tg-rotation', { ifAvailable: true }, async (lock) => {
        if (!lock || loadPendingRotation()) throw new RotationError('busy');
        const operation = await getClient().request<PendingRotation>({ action: 'sign', answers, fee: preview.fee });
        // Durable PUBLIC metadata before the first possible broadcast. If this
        // write fails, do NOT send. A reload can monitor an ambiguous result.
        savePendingRotation(operation);
        pendingRef.current = operation;
        setPending(operation); setStatus('pending'); setVisible(false); setAnswers(['', '', '']);
        await getClient().request({ action: 'send', messageHash: operation.messageHash });
      });
    } catch (error) { if (mounted.current) fail(error); }
    finally { if (mounted.current) setBusy(false); }
  };

  const back = () => {
    client.current?.dispose(); client.current = null;
    preview?.words.fill(''); setPreview(null); setVisible(false); setSeen(false); setSaved(false);
    setAnswers(['', '', '']); setError(null);
  };
  const finish = () => {
    if (!pending) return;
    try { clearPendingRotation(pending); preview?.words.fill(''); onClose(status === 'confirmed'); }
    catch (error) { fail(error); }
  };

  return <div className="rotation-flow">
    <div className="rotation-heading">
      <span className="local-pill"><TelegramLogo weight="fill" /> WalletTg · Mainnet</span>
      <h1>{text('Новая фраза. Тот же адрес.', 'New phrase. Same address.')}</h1>
      <p>{text('Смена ключа прямо в блокчейне — кнопка в Telegram не нужна.', 'Change your key on-chain, even without a button in Telegram.')}</p>
    </div>

    {error && <div className="error-banner" role="alert">{errors[error][ru ? 0 : 1]}</div>}

    {!preview && !pending && <form className="panel rotation-card" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
      <h2>{text('1. Проверьте свой кошелёк', '1. Check your wallet')}</h2>
      <p>{text('Поддерживается tgWallet (WalletTg). TON Space, W5, v4R2 и биржевой Crypto Wallet используют другие схемы.', 'Supports tgWallet (WalletTg). TON Space, W5, v4R2 and custodial Crypto Wallet use different schemes.')}</p>
      <label>{text('Адрес кошелька', 'Wallet address')}<input autoComplete="off" spellCheck={false} value={address}
        onChange={(event) => setAddress(event.target.value)} placeholder="UQ…" required disabled={busy} /></label>
      <label>{text('Текущая фраза: 12 или 24 слова', 'Current phrase: 12 or 24 words')}<textarea autoComplete="off" autoCorrect="off"
        autoCapitalize="none" spellCheck={false} rows={4} value={phrase} maxLength={300} data-private="true"
        onChange={(event) => setPhrase(event.target.value)} required disabled={busy} /></label>
      <p className="rotation-note"><LockKey />{text('Слова обрабатываются только на устройстве. TON Center через прокси TonSuite получает публичный адрес, оценку и подписанную операцию. Комиссия оплачивается с этого кошелька.', 'Words are processed only on your device. TON Center, via TonSuite’s proxy, receives the public address, fee estimate and signed operation. This wallet pays the network fee.')}</p>
      <button className="primary-button" type="submit" disabled={busy || !ready || !phrase.trim() || !address.trim()}>
        {busy ? text('Проверяем…', 'Checking…') : text('Проверить и создать новую фразу', 'Check and create a new phrase')}</button>
      <button type="button" className="text-button" onClick={() => onClose()} disabled={busy}><ArrowLeft />{text('К подбору адреса', 'Back to address generation')}</button>
    </form>}

    {(preview || pending) && <section className="panel rotation-card" aria-label={text('Адрес и комиссия', 'Address and fee')}>
      <span className="rotation-label">{text('Адрес остаётся прежним', 'Your address stays the same')}</span>
      <code className="rotation-address">{pending?.address ?? preview?.address}</code>
      {preview && !pending && <>
        <div className="rotation-facts"><span>{text('Баланс', 'Balance')}<b>{formatTon(preview.balance)} TON</b></span>
          <span>{text('Оценка комиссии', 'Estimated fee')}<b>≈ {formatTon(preview.fee)} TON</b></span></div>
        <p>{text('Перед отправкой проверим комиссию повторно. Допустимое изменение оценки: +10% и 0,001 TON. Фактическую комиссию определяет сеть.', 'We recheck fees before sending. Estimate tolerance: +10% and 0.001 TON. The network determines the actual fee.')}</p>
        {preview.deploy && <p className="rotation-notice">{text('Кошелёк ещё не активирован. Эта операция развернёт WalletTg и сразу заменит ключ.', 'This wallet is not active yet. This operation deploys WalletTg and replaces its key.')}</p>}
      </>}
    </section>}

    {preview && <section className="panel rotation-card">
      <h2>{text('2. Сохраните все 24 слова', '2. Save all 24 words')}</h2>
      <p>{text('Слова 1–12 сохраняют адрес. Слова 13–24 — новый секретный ключ. Для импорта в Telegram нужны все 24 слова в этом порядке.', 'Words 1–12 preserve the address. Words 13–24 are the new signing key. Import all 24 words into Telegram in this order.')}</p>
      <button className="secondary-button" type="button" onClick={() => { setVisible(!visible); setSeen(true); }} disabled={busy}>
        {visible ? <EyeSlash /> : <Eye />}{visible ? text('Скрыть фразу', 'Hide phrase') : text('Показать новую фразу', 'Reveal new phrase')}</button>
      {visible && <ol className="rotation-words" data-private="true">{preview.words.map((word, i) => <li key={i}><span>{i + 1}</span>{word}</li>)}</ol>}
      <p className="rotation-notice">{text('Храните старую и новую фразы до подтверждения в блокчейне. После успеха старая фраза больше не сможет подписывать операции. Мы не сохраняем слова и не сможем их восстановить.', 'Keep both phrases until the blockchain confirms the change. After success, the old phrase can no longer sign. We do not store the words and cannot recover them.')}</p>
    </section>}

    {preview && !pending && <section className="panel rotation-card">
      <h2>{text('3. Проверьте запись и смените ключ', '3. Check your backup and change the key')}</h2>
      <label className="rotation-checkbox"><input type="checkbox" checked={saved} disabled={!seen || busy}
        onChange={(event) => setSaved(event.target.checked)} />{text('Я сохранил все 24 слова новой фразы и старую фразу.', 'I saved all 24 new words and kept my old phrase.')}</label>
      {seen && !visible && <div className="rotation-quiz">{preview.quiz.map((position, i) => <label key={position}>
        {text('Слово', 'Word')} {position + 1}<input autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} data-private="true"
          value={answers[i]} disabled={busy} onChange={(event) => setAnswers((old) => old.map((word, j) => j === i ? event.target.value : word))} /></label>)}</div>}
      {visible && <p>{text('Скройте фразу, затем введите три слова из своей записи.', 'Hide the phrase, then enter three words from your backup.')}</p>}
      <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || !saved || !seen || visible || !quizValid}>
        {busy ? text('Проверяем и отправляем…', 'Checking and sending…') : text('Сменить ключ и оплатить комиссию', 'Change key and pay the fee')}</button>
      <p className="rotation-note">{text('Перед отправкой браузер сохранит только публичный журнал операции: адрес, публичные ключи, срок и хеш сообщения. Это позволит проверить результат после перезагрузки.', 'Before sending, the browser saves only public operation metadata: address, public keys, expiry and message hash. This lets you check the result after reloading.')}</p>
      <button type="button" className="text-button" onClick={back} disabled={busy}>{text('Назад, без смены ключа', 'Go back without changing the key')}</button>
    </section>}

    {pending && <section className="panel rotation-card" aria-live="polite">
      <h2>{status === 'confirmed' ? <><CheckCircle weight="fill" />{text('Ключ заменён. Адрес сохранён.', 'Key changed. Address preserved.')}</>
        : status === 'expired' || status === 'superseded' ? text('Ключ не изменён этой операцией', 'This operation did not change the key')
        : status === 'conflict' ? text('Обнаружен другой ключ', 'A different key was found')
        : text('Проверяем подтверждение в сети', 'Checking blockchain confirmation')}</h2>
      <p>{status === 'confirmed'
        ? text('Блокчейн подтвердил новый публичный ключ. Импортируйте новую фразу из 24 слов в нативный кошелёк «Деньги» (Money) в Telegram и обновите резервную копию. Старое подключение TON Connect при необходимости подключите заново.', 'The blockchain confirms your new public key. Import the new 24 words into Telegram’s native Money wallet and update your backup. Reconnect existing TON Connect sessions if needed.')
        : status === 'expired' || status === 'superseded'
        ? text('В сети остался прежний ключ; эта подпись больше не может сработать. Старая фраза актуальна. Новую фразу из этой попытки не импортируйте.', 'The previous key is still on-chain; this signed request can no longer execute. Keep using the old phrase. Do not import this attempt’s new phrase.')
        : status === 'conflict'
        ? text('Текущий ключ отличается от обоих ожидаемых. Сохраните обе фразы и проверьте историю кошелька. Повторную смену здесь не отправляем.', 'The current key differs from both expected keys. Keep both phrases and inspect the wallet history. No new rotation will be sent here.')
        : text('Ответ отправки ещё не означает успех. Даже при ошибке связи операция могла попасть в сеть. Сохраните обе фразы. После перезагрузки откройте этот режим — проверка продолжится.', 'A send response is not confirmation. A network error may occur after broadcast. Keep both phrases. After reloading, reopen this mode to resume checking.')}</p>
      {!preview && <p className="rotation-notice">{text('Проверка восстановлена из публичного журнала. Новая фраза осталась только в вашей сохранённой записи.', 'Checking resumed from the public journal. Your new phrase exists only in the backup you saved.')}</p>}
      <a className="text-button" href={`https://tonviewer.com/${pending.address}`} target="_blank" rel="noreferrer">{text('Открыть адрес в обозревателе', 'View address in explorer')}</a>
      <details><summary>{text('Данные операции', 'Operation details')}</summary><p>{text('Хеш сообщения', 'Message hash')}</p><code className="rotation-address">{pending.messageHash}</code>
        <p>seqno: {pending.seqno} · {text('Срок подписи', 'Signature expires')}: {new Date(pending.validUntil * 1000).toLocaleString(ru ? 'ru-RU' : 'en-US')}</p></details>
      {status !== 'confirmed' && <button type="button" className="secondary-button" disabled={checking || busy}
        onClick={() => void check(pending)}>{checking ? text('Проверяем…', 'Checking…') : text('Проверить снова', 'Check again')}</button>}
      {['confirmed', 'expired', 'superseded'].includes(status) && <button type="button" className="primary-button" onClick={finish}>
        {text('Готово, очистить журнал', 'Done, clear public journal')}</button>}
    </section>}
  </div>;
}
