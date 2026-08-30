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
    'content="Локальный генератор красивых TON-адресов v4R2 и W5. Перебор и сид-фраза остаются только в вашем браузере."',
    'content="Generate vanity TON Wallet v4R2 and W5 addresses locally. Address search and recovery phrases stay in your browser."',
    'Meta description',
  ],
  [
    '<meta property="og:title" content="TON Vanity Generator — TonSuite" />',
    '<meta property="og:title" content="TON Vanity Address Generator — TonSuite" />',
    'Open Graph title',
  ],
  [
    'content="Охотьтесь за красивым окончанием TON-адреса прямо на своём устройстве."',
    'content="Hunt for a custom TON address ending locally on your own device."',
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
    '<title>TON Vanity Generator — TonSuite</title>',
    '<title>TON Vanity Address Generator — TonSuite</title>',
    'Document title',
  ],
]) {
  englishHtml = replaceExactlyOnce(englishHtml, source, replacement, label);
}

for (const assetReference of sharedAssetReferences) {
  if (!englishHtml.includes(assetReference)) {
    throw new Error(`Shared asset reference changed unexpectedly: ${assetReference}`);
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, englishHtml, 'utf8');

console.log(`English generator page: ${outputPath}`);
