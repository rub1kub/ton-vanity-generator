import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const sourceDir = resolve(process.argv[2] || '.server/snapshot');
const outputDir = resolve(process.argv[3] || '.server/patched');

const expectedHashes = {
  'index.html': 'b2b04ad17704ffe99ecab38e790e252c67bcfbd89a0e5ec1a3733d95f9bf3cc2',
  'en/index.html': '66c183d6a061c83ae6100e4640d0a8d551839f5cda8fd1a152c687bae386851e',
  'assets/index-CZhtzZIH.js': 'c9290be5cd75ac4c8c045eefcf5fc19234b738169192c5ef8e26dfc340419a39',
  'sitemap.xml': 'f42110e5f902b586407e31a98d679af3aba8d44f2e0de79d4f9250a88d55fcd2',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readGuarded(relativePath) {
  const value = readFileSync(join(sourceDir, relativePath), 'utf8');
  const expected = expectedHashes[relativePath];
  if (expected && sha256(value) !== expected) {
    throw new Error(`Refusing to patch changed source: ${relativePath}`);
  }
  return value;
}

function replaceOnce(value, before, after, label) {
  const pieces = value.split(before);
  if (pieces.length !== 2) {
    throw new Error(`${label}: expected exactly one match, got ${pieces.length - 1}`);
  }
  return `${pieces[0]}${after}${pieces[1]}`;
}

function writeOutput(relativePath, value) {
  const destination = join(outputDir, relativePath);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  writeFileSync(destination, value);
}

let bundle = readGuarded('assets/index-CZhtzZIH.js');

bundle = replaceOnce(
  bundle,
  'href:Nt(e)}];',
  'href:Nt(e)},{avatar:`/assets/projects/ton-generator.svg`,avatarSize:512,title:`TON Generator`,text:k(e,`Красивые TON-адреса локально`,`Vanity TON addresses, generated locally`),href:k(e,`/generator/`,`/en/generator/`)}];',
  'flagship generator card',
);
bundle = replaceOnce(
  bundle,
  'TonSuite: три продукта для экосистемы TON.',
  'TonSuite: четыре продукта для экосистемы TON.',
  'Russian flagship count',
);
bundle = replaceOnce(
  bundle,
  'TonSuite: three products for the TON ecosystem.',
  'TonSuite: four products for the TON ecosystem.',
  'English flagship count',
);
bundle = replaceOnce(
  bundle,
  'TON Tracker объясняет движение кошельков. LOOP переносит игровые механики в сеть TON. TON BuyBot превращает покупки токена в понятные события Telegram-чата.',
  'TON Tracker объясняет движение кошельков. LOOP переносит игровые механики в сеть TON. TON BuyBot превращает покупки токена в понятные события Telegram-чата. TON Generator ищет красивое окончание адреса прямо на вашем устройстве.',
  'Russian hero copy',
);
bundle = replaceOnce(
  bundle,
  'TON Tracker explains wallet activity. Buy Bot turns token purchases into chat events. LOOP brings game mechanics on-chain. The rest of the suite adds data and signals around them.',
  'TON Tracker explains wallet activity. Buy Bot turns token purchases into chat events. LOOP brings game mechanics on-chain. TON Generator hunts for a vanity address ending right on your device.',
  'English hero copy',
);
bundle = replaceOnce(
  bundle,
  '(0,O.jsx)(`a`,{href:Nt(e),onClick:()=>r(!1),children:`TON BuyBot`}),(0,O.jsx)(`a`,{href:`${jt(e)}#projects`',
  '(0,O.jsx)(`a`,{href:Nt(e),onClick:()=>r(!1),children:`TON BuyBot`}),(0,O.jsx)(`a`,{href:k(e,`/generator/`,`/en/generator/`),onClick:()=>r(!1),children:`TON Generator`}),(0,O.jsx)(`a`,{href:`${jt(e)}#projects`',
  'header navigation',
);
bundle = replaceOnce(
  bundle,
  '(0,O.jsx)(A,{href:Ct,children:`LOOP`}),r?',
  '(0,O.jsx)(A,{href:Ct,children:`LOOP`}),(0,O.jsx)(`a`,{href:k(e,`/generator/`,`/en/generator/`),children:`TON Generator`}),r?',
  'footer navigation',
);

const projectsStart = bundle.indexOf('function qt({locale:e})');
const projectsEnd = bundle.indexOf('function Jt({locale:e})', projectsStart);
if (projectsStart < 0 || projectsEnd < 0) {
  throw new Error('Unable to isolate the secondary project list');
}
let projects = bundle.slice(projectsStart, projectsEnd);
for (const [before, after] of [
  ['09', '10'],
  ['08', '09'],
  ['07', '08'],
  ['06', '07'],
  ['05', '06'],
  ['04', '05'],
]) {
  projects = replaceOnce(projects, `number:\`${before}\``, `number:\`${after}\``, `project number ${before}`);
}
bundle = `${bundle.slice(0, projectsStart)}${projects}${bundle.slice(projectsEnd)}`;

const bundleHash = sha256(bundle).slice(0, 12);
const bundleName = `index-${bundleHash}.js`;
writeOutput(`assets/${bundleName}`, bundle);

const arrowSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"></path></svg>';

function updateStructuredData(html, locale) {
  const pattern = /<script type="application\/ld\+json">([^<]+)<\/script>/;
  const match = html.match(pattern);
  if (!match) throw new Error(`${locale}: JSON-LD not found`);
  const data = JSON.parse(match[1]);
  const page = data['@graph'].find((item) => item['@type'] === 'CollectionPage');
  page.dateModified = '2026-08-30';
  page.description = locale === 'ru'
    ? 'TonSuite объединяет TON Tracker, LOOP, TON BuyBot, TON Generator и шесть дополнительных инструментов для кошельков, токенов, исследований и крупных биржевых выводов.'
    : 'Explore 10 TonSuite products for TON: TON Tracker, LOOP, Buy Bot, TON Generator, TON Locks, Price Pulse, TON Researcher, Eye of TON, CEX Withdrawals, and ton4.pro.';
  const list = page.mainEntity.itemListElement;
  list.forEach((item) => {
    if (item.position >= 4) item.position += 1;
  });
  list.splice(3, 0, {
    '@type': 'ListItem',
    position: 4,
    name: 'TON Generator',
    url: locale === 'ru'
      ? 'https://tonsuite.org/generator/'
      : 'https://tonsuite.org/en/generator/',
  });
  return html.replace(pattern, `<script type="application/ld+json">${JSON.stringify(data)}</script>`);
}

function patchHomepage(locale) {
  const relativePath = locale === 'ru' ? 'index.html' : 'en/index.html';
  let html = readGuarded(relativePath);
  const isRussian = locale === 'ru';
  const generatorPath = isRussian ? '/generator/' : '/en/generator/';

  html = replaceOnce(html, '/assets/index-CZhtzZIH.js', `/assets/${bundleName}`, `${locale}: bundle reference`);
  html = replaceOnce(
    html,
    '<link rel="preload" as="image" href="/assets/projects/ton-buybot.jpg"/>',
    '<link rel="preload" as="image" href="/assets/projects/ton-buybot.jpg"/><link rel="preload" as="image" href="/assets/projects/ton-generator.svg"/>',
    `${locale}: generator preload`,
  );

  const oldDescription = isRussian
    ? 'TonSuite объединяет TON Tracker, LOOP, TON BuyBot и шесть дополнительных инструментов для кошельков, токенов, исследований и крупных биржевых выводов.'
    : 'Explore 9 TonSuite products for TON: TON Tracker, LOOP, Buy Bot, TON Locks, Price Pulse, TON Researcher, Eye of TON, CEX Withdrawals, and ton4.pro.';
  const newDescription = isRussian
    ? 'TonSuite объединяет TON Tracker, LOOP, TON BuyBot, TON Generator и шесть дополнительных инструментов для кошельков, токенов, исследований и крупных биржевых выводов.'
    : 'Explore 10 TonSuite products for TON: TON Tracker, LOOP, Buy Bot, TON Generator, TON Locks, Price Pulse, TON Researcher, Eye of TON, CEX Withdrawals, and ton4.pro.';
  html = html.replaceAll(oldDescription, newDescription);

  const oldSocial = isRussian
    ? 'TON Tracker, LOOP, TON BuyBot и другие инструменты для кошельков, игр, токенов и исследований.'
    : 'TON Tracker, LOOP, Buy Bot, TON Locks, Price Pulse, TON Researcher, CEX Withdrawals, and more in one ecosystem.';
  const newSocial = isRussian
    ? 'TON Tracker, LOOP, TON BuyBot, TON Generator и другие инструменты для кошельков, игр, токенов и исследований.'
    : 'TON Tracker, LOOP, Buy Bot, TON Generator, TON Locks, Price Pulse, TON Researcher, CEX Withdrawals, and more in one ecosystem.';
  html = replaceOnce(html, oldSocial, newSocial, `${locale}: social description`);

  html = replaceOnce(
    html,
    isRussian ? 'TonSuite: три продукта для экосистемы TON.' : 'TonSuite: three products for the TON ecosystem.',
    isRussian ? 'TonSuite: четыре продукта для экосистемы TON.' : 'TonSuite: four products for the TON ecosystem.',
    `${locale}: rendered flagship count`,
  );
  html = replaceOnce(
    html,
    isRussian
      ? 'TON Tracker объясняет движение кошельков. LOOP переносит игровые механики в сеть TON. TON BuyBot превращает покупки токена в понятные события Telegram-чата.'
      : 'TON Tracker explains wallet activity. Buy Bot turns token purchases into chat events. LOOP brings game mechanics on-chain. The rest of the suite adds data and signals around them.',
    isRussian
      ? 'TON Tracker объясняет движение кошельков. LOOP переносит игровые механики в сеть TON. TON BuyBot превращает покупки токена в понятные события Telegram-чата. TON Generator ищет красивое окончание адреса прямо на вашем устройстве.'
      : 'TON Tracker explains wallet activity. Buy Bot turns token purchases into chat events. LOOP brings game mechanics on-chain. TON Generator hunts for a vanity address ending right on your device.',
    `${locale}: rendered hero copy`,
  );

  html = replaceOnce(
    html,
    isRussian
      ? '<a href="/buybot/">TON BuyBot</a><a href="/#projects">Другие проекты</a>'
      : '<a href="/en/buybot/">TON BuyBot</a><a href="/en/#projects">More projects</a>',
    isRussian
      ? '<a href="/buybot/">TON BuyBot</a><a href="/generator/">TON Generator</a><a href="/#projects">Другие проекты</a>'
      : '<a href="/en/buybot/">TON BuyBot</a><a href="/en/generator/">TON Generator</a><a href="/en/#projects">More projects</a>',
    `${locale}: rendered header navigation`,
  );

  const generatorText = isRussian ? 'Красивые TON-адреса локально' : 'Vanity TON addresses, generated locally';
  const generatorCard = `<a href="${generatorPath}" class="suite-quick-link" aria-label="TON Generator: ${generatorText}"><span class="suite-quick-number">0<!-- -->4</span><span class="suite-quick-icon" aria-hidden="true"><img src="/assets/projects/ton-generator.svg" alt="" width="512" height="512" decoding="async"/></span><span><strong>TON Generator</strong><small>${generatorText}</small></span>${arrowSvg}</a>`;
  html = replaceOnce(
    html,
    '</a></nav></div></section><section class="section suite-projects"',
    `</a>${generatorCard}</nav></div></section><section class="section suite-projects"`,
    `${locale}: rendered generator card`,
  );

  for (const [before, after] of [
    ['09', '10'],
    ['08', '09'],
    ['07', '08'],
    ['06', '07'],
    ['05', '06'],
    ['04', '05'],
  ]) {
    html = replaceOnce(
      html,
      `<span class="project-number">${before}</span>`,
      `<span class="project-number">${after}</span>`,
      `${locale}: rendered project number ${before}`,
    );
  }

  html = replaceOnce(
    html,
    isRussian
      ? '<a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/tracker/#pricing">Премиум</a>'
      : '<a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/en/tracker/#pricing">Premium</a>',
    isRussian
      ? '<a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/generator/">TON Generator</a><a href="/tracker/#pricing">Премиум</a>'
      : '<a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/en/generator/">TON Generator</a><a href="/en/tracker/#pricing">Premium</a>',
    `${locale}: rendered footer navigation`,
  );

  html = updateStructuredData(html, locale);
  writeOutput(relativePath, html);
}

patchHomepage('ru');
patchHomepage('en');

let llms = readFileSync(join(sourceDir, 'llms.txt'), 'utf8');
llms = llms
  .replaceAll('2026-08-27', '2026-08-30')
  .replace('overview of nine TON products.', 'overview of ten TON products.')
  .replace(
    '- [TON BuyBot](https://tonsuite.org/buybot/): Telegram alerts for TON token purchases.',
    '- [TON BuyBot](https://tonsuite.org/buybot/): Telegram alerts for TON token purchases.\n- [TON Generator](https://tonsuite.org/generator/): local W5/v4R2 vanity-address search with a TEP-3 recovery phrase.',
  )
  .replace(
    '- Product pages show authentic Telegram captures.',
    '- TON Generator runs wallet search in browser Web Workers and does not send candidate keys or recovery words to a backend.\n- Product pages show authentic Telegram captures.',
  );
writeOutput('llms.txt', llms);

let llmsFull = readFileSync(join(sourceDir, 'llms-full.txt'), 'utf8');
llmsFull = llmsFull
  .replaceAll('2026-08-27', '2026-08-30')
  .replace(
    '## LOOP\n\nURL: https://app.tonsuite.org/\nPurpose: a TON-connected game and one of the three flagship TonSuite products.',
    "## TON Generator\n\nCanonical page: https://tonsuite.org/generator/\nSource: https://github.com/rub1kub/ton-vanity-generator\nPurpose: search locally for a chosen ending in a TON W5 or v4R2 friendly address. It uses 12-word BIP39/TEP-3 recovery phrases at m/44'/607'/0', browser Web Workers, and no backend wallet-generation API. Search duration is probabilistic.\n\n## LOOP\n\nURL: https://app.tonsuite.org/\nPurpose: a TON-connected game and one of the four flagship TonSuite products.",
  );
writeOutput('llms-full.txt', llmsFull);

let sitemap = readGuarded('sitemap.xml');
let rootDatesUpdated = 0;
sitemap = sitemap.replace(/<lastmod>2026-08-27<\/lastmod>/g, (match) => {
  rootDatesUpdated += 1;
  return rootDatesUpdated <= 2 ? '<lastmod>2026-08-30</lastmod>' : match;
});
const generatorUrl = `  <url>\n    <loc>https://tonsuite.org/generator/</loc>\n    <xhtml:link rel="alternate" hreflang="ru" href="https://tonsuite.org/generator/" />\n    <xhtml:link rel="alternate" hreflang="en" href="https://tonsuite.org/en/generator/" />\n    <xhtml:link rel="alternate" hreflang="x-default" href="https://tonsuite.org/generator/" />\n    <lastmod>2026-08-30</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>\n  </url>\n  <url>\n    <loc>https://tonsuite.org/en/generator/</loc>\n    <xhtml:link rel="alternate" hreflang="ru" href="https://tonsuite.org/generator/" />\n    <xhtml:link rel="alternate" hreflang="en" href="https://tonsuite.org/en/generator/" />\n    <xhtml:link rel="alternate" hreflang="x-default" href="https://tonsuite.org/generator/" />\n    <lastmod>2026-08-30</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
sitemap = replaceOnce(sitemap, '</urlset>', `${generatorUrl}</urlset>`, 'generator sitemap entry');
writeOutput('sitemap.xml', sitemap);

const outputs = [
  `assets/${bundleName}`,
  'index.html',
  'en/index.html',
  'sitemap.xml',
  'llms.txt',
  'llms-full.txt',
];
const manifest = Object.fromEntries(outputs.map((file) => {
  const value = readFileSync(join(outputDir, file));
  return [file, { sha256: sha256(value), bytes: value.length }];
}));
writeOutput('patch-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Patched homepage bundle: ${basename(bundleName)}`);
console.log(JSON.stringify(manifest, null, 2));
