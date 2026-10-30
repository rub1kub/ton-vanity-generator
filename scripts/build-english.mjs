import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const sourcePath = resolve('dist/index.html');
const outputPath = resolve('dist/en/generator/index.html');

function replaceExactlyOnce(html, source, replacement, label) {
  const parts = html.split(source);
  if (parts.length !== 2) {
    throw new Error(
      `${label}: expected exactly one Russian build marker, found ${parts.length - 1}`,
    );
  }

  return `${parts[0]}${replacement}${parts[1]}`;
}

const russianHtml = readFileSync(sourcePath, 'utf8');
const sharedAssetReferences = russianHtml.match(
  /(?:src|href)="\/generator\/assets\/[^"]+"/g,
);

if (!sharedAssetReferences?.length) {
  throw new Error(
    'Shared assets: dist/index.html has no absolute /generator/assets/ references',
  );
}

let englishHtml = russianHtml;

for (const [source, replacement, label] of [
  ['<html lang="ru">', '<html lang="en">', 'Document language'],
  [
    'content="Создайте красивый TON-адрес для Telegram (tgWallet), W5 или v4R2. Генерация выполняется на вашем устройстве, без отправки секретной фразы на сервер."',
    'content="Generate vanity TON addresses for Telegram (tgWallet), W5 and v4R2 locally. Recovery phrases stay on your device."',
    'Meta description',
  ],
  [
    '<meta property="og:title" content="Генератор TON-адресов: tgWallet, W5 и v4R2 | TonSuite" />',
    '<meta property="og:title" content="TON Vanity Address Generator — tgWallet, W5 &amp; v4R2 | TonSuite" />',
    'Open Graph title',
  ],
  [
    '<meta\n      property="og:description"\n      content="Подберите окончание TON-адреса локально в браузере. Поддерживаются tgWallet (Telegram), W5 и v4R2."\n    />',
    '<meta property="og:description" content="Find a custom TON address ending locally for Telegram (tgWallet), W5 or v4R2." />',
    'Open Graph description',
  ],
  [
    '<meta property="og:url" content="https://tonsuite.org/generator/" />',
    '<meta property="og:url" content="https://tonsuite.org/en/generator/" />',
    'Open Graph URL',
  ],
  [
    '<link rel="canonical" href="https://tonsuite.org/generator/" />',
    '<link rel="canonical" href="https://tonsuite.org/en/generator/" />',
    'Canonical URL',
  ],
  [
    '<link rel="icon" type="image/jpeg" href="./brand/tonsuite-icon.jpg" />',
    '<link rel="icon" type="image/jpeg" href="/generator/brand/tonsuite-icon.jpg" />',
    'Favicon',
  ],
  [
    '<link rel="apple-touch-icon" href="./brand/tonsuite-icon.jpg" />',
    '<link rel="apple-touch-icon" href="/generator/brand/tonsuite-icon.jpg" />',
    'Apple touch icon',
  ],
  [
    '<title>Генератор TON-адресов: tgWallet, W5 и v4R2 | TonSuite</title>',
    '<title>TON Vanity Address Generator — tgWallet, W5 &amp; v4R2 | TonSuite</title>',
    'Document title',
  ],
  [
    '<meta property="og:locale" content="ru_RU" />',
    '<meta property="og:locale" content="en_US" />',
    'Open Graph locale',
  ],
  [
    '<meta name="twitter:title" content="Генератор TON-адресов: tgWallet, W5 и v4R2 | TonSuite" />',
    '<meta name="twitter:title" content="TON Vanity Address Generator — tgWallet, W5 &amp; v4R2 | TonSuite" />',
    'Twitter title',
  ],
  [
    '<meta name="twitter:description" content="Подберите окончание TON-адреса локально в браузере. Поддерживаются tgWallet (Telegram), W5 и v4R2." />',
    '<meta name="twitter:description" content="Find a custom TON address ending locally for Telegram (tgWallet), W5 or v4R2." />',
    'Twitter description',
  ],
  [
    '<meta property="og:image:alt" content="Генератор красивых TON-адресов TonSuite" />',
    '<meta property="og:image:alt" content="TonSuite vanity TON address generator" />',
    'Open Graph image description',
  ],
  [
    '<meta name="twitter:image:alt" content="Генератор красивых TON-адресов TonSuite" />',
    '<meta name="twitter:image:alt" content="TonSuite vanity TON address generator" />',
    'Twitter image description',
  ],
]) {
  englishHtml = replaceExactlyOnce(englishHtml, source, replacement, label);
}

englishHtml = englishHtml.replace(/<script type="application\/ld\+json">(.*?)<\/script>/, (_, json) => {
  const data = JSON.parse(json);
  data.name = 'TON Vanity Address Generator';
  data.url = 'https://tonsuite.org/en/generator/';
  data.description = 'Local vanity TON address generator for Telegram (tgWallet), W5 and v4R2.';
  data.publisher.url = 'https://tonsuite.org/en/';
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
});

for (const assetReference of sharedAssetReferences) {
  if (!englishHtml.includes(assetReference)) {
    throw new Error(`Shared asset reference changed unexpectedly: ${assetReference}`);
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, englishHtml, 'utf8');

console.log(`English generator page: ${outputPath}`);
