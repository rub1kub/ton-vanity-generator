import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  'let t=[{avatar:`/assets/projects/ton-tracker.jpg`,avatarSize:640,title:`TON Tracker`,text:k(e,`Кошельки, позиции и умные сигналы`,`Wallets, positions, and smart signals`),href:Mt(e)},{avatar:`/assets/projects/loop.svg`,avatarSize:512,title:`LOOP`,text:k(e,`Игровые механики в сети TON`,`Game mechanics on TON`),href:Ct,external:!0},{avatar:`/assets/projects/ton-buybot.jpg`,avatarSize:640,title:`TON BuyBot`,text:k(e,`Покупки токена как события чата`,`Token buys as chat events`),href:Nt(e)}];',
  'let t=[{avatar:`/assets/projects/ton-tracker.jpg`,avatarSize:640,title:`TON Tracker`,text:k(e,`Кошельки, позиции и умные сигналы`,`Wallets, positions, and smart signals`),href:Mt(e)},{avatar:`/assets/projects/ton-buybot.jpg`,avatarSize:640,title:`TON BuyBot`,text:k(e,`Покупки токена как события чата`,`Token buys as chat events`),href:Nt(e)},{avatar:`/assets/projects/ton-generator.svg`,avatarSize:512,title:`TON Generator`,text:k(e,`Красивые адреса локально`,`Vanity addresses, generated locally`),href:k(e,`/generator/`,`/en/generator/`)},{avatar:`/assets/projects/loop.svg`,avatarSize:512,title:`LOOP`,text:k(e,`Игровые механики ончейн`,`On-chain game mechanics`),href:Ct,external:!0}];',
  'flagship product order',
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
  'TON Tracker объясняет движение кошельков. TON BuyBot превращает покупки токена в события Telegram-чата. TON Generator ищет красивое окончание адреса на вашем устройстве. LOOP добавляет игровые механики ончейн.',
  'Russian hero copy',
);
bundle = replaceOnce(
  bundle,
  'TON Tracker explains wallet activity. Buy Bot turns token purchases into chat events. LOOP brings game mechanics on-chain. The rest of the suite adds data and signals around them.',
  'TON Tracker explains wallet activity. Buy Bot turns token purchases into chat events. TON Generator hunts for a vanity ending on your device. LOOP adds on-chain game mechanics.',
  'English hero copy',
);
bundle = replaceOnce(
  bundle,
  '(0,O.jsx)(`a`,{href:Mt(e),onClick:()=>r(!1),children:`TON Tracker`}),(0,O.jsx)(A,{href:Ct,children:`LOOP`}),(0,O.jsx)(`a`,{href:Nt(e),onClick:()=>r(!1),children:`TON BuyBot`}),(0,O.jsx)(`a`,{href:`${jt(e)}#projects`',
  '(0,O.jsx)(`a`,{href:Mt(e),onClick:()=>r(!1),children:`TON Tracker`}),(0,O.jsx)(`a`,{href:Nt(e),onClick:()=>r(!1),children:`TON BuyBot`}),(0,O.jsx)(`a`,{href:k(e,`/generator/`,`/en/generator/`),onClick:()=>r(!1),children:`TON Generator`}),(0,O.jsx)(A,{href:Ct,children:`LOOP`}),(0,O.jsx)(`a`,{href:`${jt(e)}#projects`',
  'header navigation',
);
bundle = replaceOnce(
  bundle,
  '(0,O.jsx)(`a`,{href:Nt(e),children:`TON BuyBot`}),(0,O.jsx)(A,{href:Ct,children:`LOOP`}),r?',
  '(0,O.jsx)(`a`,{href:Nt(e),children:`TON BuyBot`}),(0,O.jsx)(`a`,{href:k(e,`/generator/`,`/en/generator/`),children:`TON Generator`}),(0,O.jsx)(A,{href:Ct,children:`LOOP`}),r?',
  'footer navigation',
);

const projectsStart = bundle.indexOf('function qt({locale:e})');
const projectsEnd = bundle.indexOf('function Jt({locale:e})', projectsStart);
if (projectsStart < 0 || projectsEnd < 0) {
  throw new Error('Unable to isolate the secondary project list');
}
let projects = bundle.slice(projectsStart, projectsEnd);
for (const [before, after] of [
  ['09', '12'],
  ['08', '11'],
  ['07', '10'],
  ['06', '09'],
  ['05', '08'],
  ['04', '07'],
]) {
  projects = replaceOnce(projects, `number:\`${before}\``, `number:\`${after}\``, `project number ${before}`);
}
projects = replaceOnce(
  projects,
  'let t=[{number:`07`',
  'let t=[{number:`05`,avatar:`/assets/projects/ton-changes.png`,avatarSize:640,title:`TON Changes`,status:k(e,`Изменения экосистемы`,`Ecosystem changes`),text:k(e,`Отслеживает изменения в экосистемах TON и Telegram — новые продукты, возможности и заметные обновления.`,`Tracks changes across the TON and Telegram ecosystems, including new products, capabilities, and notable updates.`),href:`https://t.me/tonwebchanges`,external:!0},{number:`06`,avatar:`/assets/projects/web-tracker-robot.png`,avatarSize:640,title:`Web Tracker Robot`,status:k(e,`Раннее обнаружение`,`Early discovery`),text:k(e,`Замечает новые страницы, адреса и функции на сайтах раньше официальных анонсов.`,`Spots new pages, addresses, and website features before official announcements.`),href:`https://t.me/webtracker_robot`,external:!0},{number:`07`',
  'new project cards',
);
projects = replaceOnce(
  projects,
  'Ещё шесть инструментов TonSuite.',
  'Ещё восемь инструментов TonSuite.',
  'Russian project count',
);
projects = replaceOnce(
  projects,
  'Six more TonSuite tools.',
  'Eight more TonSuite tools.',
  'English project count',
);
projects = replaceOnce(
  projects,
  'Аналитика, поиск, блокировки и крупные биржевые выводы — по одному прямому переходу.',
  'Мониторинг изменений, аналитика, поиск, блокировки и крупные биржевые выводы — по одному прямому переходу.',
  'Russian project summary',
);
projects = replaceOnce(
  projects,
  'Analytics, discovery, locks, and large exchange withdrawals — each one link away.',
  'Change monitoring, analytics, discovery, locks, and large exchange withdrawals — each one link away.',
  'English project summary',
);
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
    ? 'TonSuite объединяет четыре основных продукта и восемь дополнительных инструментов для TON и Telegram.'
    : 'Explore 12 TonSuite products for TON and Telegram: four flagship products and eight additional tools.';
  const [tracker, loop, buyBot, ...rest] = page.mainEntity.itemListElement;
  const list = [
    tracker,
    buyBot,
    {
      '@type': 'ListItem',
      name: 'TON Generator',
      url: locale === 'ru'
        ? 'https://tonsuite.org/generator/'
        : 'https://tonsuite.org/en/generator/',
    },
    loop,
    {
      '@type': 'ListItem',
      name: 'TON Changes',
      url: 'https://t.me/tonwebchanges',
    },
    {
      '@type': 'ListItem',
      name: 'Web Tracker Robot',
      url: 'https://t.me/webtracker_robot',
    },
    ...rest,
  ];
  page.mainEntity.itemListElement = list.map((item, index) => ({
    ...item,
    position: index + 1,
  }));
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
    ? 'TonSuite объединяет четыре основных продукта и восемь дополнительных инструментов для TON и Telegram.'
    : 'Explore 12 TonSuite products for TON and Telegram: four flagship products and eight additional tools.';
  html = html.replaceAll(oldDescription, newDescription);

  const oldSocial = isRussian
    ? 'TON Tracker, LOOP, TON BuyBot и другие инструменты для кошельков, игр, токенов и исследований.'
    : 'TON Tracker, LOOP, Buy Bot, TON Locks, Price Pulse, TON Researcher, CEX Withdrawals, and more in one ecosystem.';
  const newSocial = isRussian
    ? 'TON Tracker, TON BuyBot, TON Generator, LOOP, TON Changes, Web Tracker Robot и другие инструменты в одной экосистеме.'
    : 'TON Tracker, Buy Bot, TON Generator, LOOP, TON Changes, Web Tracker Robot, and more in one ecosystem.';
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
      ? 'TON Tracker объясняет движение кошельков. TON BuyBot превращает покупки токена в события Telegram-чата. TON Generator ищет красивое окончание адреса на вашем устройстве. LOOP добавляет игровые механики ончейн.'
      : 'TON Tracker explains wallet activity. Buy Bot turns token purchases into chat events. TON Generator hunts for a vanity ending on your device. LOOP adds on-chain game mechanics.',
    `${locale}: rendered hero copy`,
  );

  html = replaceOnce(
    html,
    isRussian
      ? '<a href="/tracker/">TON Tracker</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/buybot/">TON BuyBot</a><a href="/#projects">Другие проекты</a>'
      : '<a href="/en/tracker/">TON Tracker</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/en/buybot/">TON BuyBot</a><a href="/en/#projects">More projects</a>',
    isRussian
      ? '<a href="/tracker/">TON Tracker</a><a href="/buybot/">TON BuyBot</a><a href="/generator/">TON Generator</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/#projects">Другие проекты</a>'
      : '<a href="/en/tracker/">TON Tracker</a><a href="/en/buybot/">TON BuyBot</a><a href="/en/generator/">TON Generator</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/en/#projects">More projects</a>',
    `${locale}: rendered header navigation`,
  );

  const flagshipCards = [
    { number: '01', title: 'TON Tracker', text: isRussian ? 'Кошельки, позиции и умные сигналы' : 'Wallets, positions, and smart signals', href: isRussian ? '/tracker/' : '/en/tracker/', image: '/assets/projects/ton-tracker.jpg', size: 640 },
    { number: '02', title: 'TON BuyBot', text: isRussian ? 'Покупки токена как события чата' : 'Token buys as chat events', href: isRussian ? '/buybot/' : '/en/buybot/', image: '/assets/projects/ton-buybot.jpg', size: 640 },
    { number: '03', title: 'TON Generator', text: isRussian ? 'Красивые адреса локально' : 'Vanity addresses, generated locally', href: generatorPath, image: '/assets/projects/ton-generator.svg', size: 512 },
    { number: '04', title: 'LOOP', text: isRussian ? 'Игровые механики ончейн' : 'On-chain game mechanics', href: 'https://app.tonsuite.org/', image: '/assets/projects/loop.svg', size: 512, external: true },
  ];
  const flagshipMarkup = flagshipCards.map((card) => {
    const external = card.external ? ' target="_blank" rel="noreferrer"' : '';
    return `<a href="${card.href}" class="suite-quick-link"${external} aria-label="${card.title}: ${card.text}"><span class="suite-quick-number">${card.number.slice(0, 1)}<!-- -->${card.number.slice(1)}</span><span class="suite-quick-icon" aria-hidden="true"><img src="${card.image}" alt="" width="${card.size}" height="${card.size}" decoding="async"/></span><span><strong>${card.title}</strong><small>${card.text}</small></span>${arrowSvg}</a>`;
  }).join('');
  const quickNavStart = html.indexOf('<nav class="suite-quick-links"');
  const quickNavEnd = html.indexOf('</nav>', quickNavStart);
  if (quickNavStart < 0 || quickNavEnd < 0) throw new Error(`${locale}: flagship navigation not found`);
  const quickNavOpenEnd = html.indexOf('>', quickNavStart) + 1;
  html = `${html.slice(0, quickNavOpenEnd)}${flagshipMarkup}${html.slice(quickNavEnd)}`;

  const newProjects = [
    {
      number: '05',
      title: 'TON Changes',
      status: isRussian ? 'Изменения экосистемы' : 'Ecosystem changes',
      text: isRussian
        ? 'Отслеживает изменения в экосистемах TON и Telegram — новые продукты, возможности и заметные обновления.'
        : 'Tracks changes across the TON and Telegram ecosystems, including new products, capabilities, and notable updates.',
      href: 'https://t.me/tonwebchanges',
      image: '/assets/projects/ton-changes.png',
    },
    {
      number: '06',
      title: 'Web Tracker Robot',
      status: isRussian ? 'Раннее обнаружение' : 'Early discovery',
      text: isRussian
        ? 'Замечает новые страницы, адреса и функции на сайтах раньше официальных анонсов.'
        : 'Spots new pages, addresses, and website features before official announcements.',
      href: 'https://t.me/webtracker_robot',
      image: '/assets/projects/web-tracker-robot.png',
    },
  ];
  const projectMarkup = newProjects.map((project) => `<a class="suite-project" href="${project.href}" target="_blank" rel="noreferrer" aria-label="${project.title}: ${project.status}"><span class="project-number">${project.number}</span><span class="project-icon" aria-hidden="true"><img src="${project.image}" alt="" width="640" height="640" loading="lazy" decoding="async"/></span><span class="project-body"><small>${project.status}</small><strong>${project.title}</strong><p>${project.text}</p></span>${arrowSvg.replace(' aria-hidden="true"', ' class="project-arrow" aria-hidden="true"')}</a>`).join('');

  for (const [before, after] of [
    ['09', '12'],
    ['08', '11'],
    ['07', '10'],
    ['06', '09'],
    ['05', '08'],
    ['04', '07'],
  ]) {
    html = replaceOnce(
      html,
      `<span class="project-number">${before}</span>`,
      `<span class="project-number">${after}</span>`,
      `${locale}: rendered project number ${before}`,
    );
  }
  html = replaceOnce(html, '<div class="project-list">', `<div class="project-list">${projectMarkup}`, `${locale}: new rendered projects`);

  html = replaceOnce(
    html,
    isRussian ? 'Ещё шесть инструментов TonSuite.' : 'Six more TonSuite tools.',
    isRussian ? 'Ещё восемь инструментов TonSuite.' : 'Eight more TonSuite tools.',
    `${locale}: rendered project count`,
  );
  html = replaceOnce(
    html,
    isRussian
      ? 'Аналитика, поиск, блокировки и крупные биржевые выводы — по одному прямому переходу.'
      : 'Analytics, discovery, locks, and large exchange withdrawals — each one link away.',
    isRussian
      ? 'Мониторинг изменений, аналитика, поиск, блокировки и крупные биржевые выводы — по одному прямому переходу.'
      : 'Change monitoring, analytics, discovery, locks, and large exchange withdrawals — each one link away.',
    `${locale}: rendered project summary`,
  );

  html = replaceOnce(
    html,
    isRussian
      ? '<a href="/buybot/">TON BuyBot</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/tracker/#pricing">Премиум</a>'
      : '<a href="/en/buybot/">TON BuyBot</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/en/tracker/#pricing">Premium</a>',
    isRussian
      ? '<a href="/buybot/">TON BuyBot</a><a href="/generator/">TON Generator</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/tracker/#pricing">Премиум</a>'
      : '<a href="/en/buybot/">TON BuyBot</a><a href="/en/generator/">TON Generator</a><a class="" href="https://app.tonsuite.org/" target="_blank" rel="noreferrer">LOOP</a><a href="/en/tracker/#pricing">Premium</a>',
    `${locale}: rendered footer navigation`,
  );

  const homepagePolish = '<style id="tonsuite-home-polish">@media (min-width:900px){.suite-hero-inner{align-items:start;gap:64px}.suite-hero-copy h1{font-size:clamp(48px,4.4vw,56px);line-height:1.02;margin-bottom:22px}.suite-hero-copy p{max-width:620px;margin-bottom:28px;font-size:18px;line-height:1.5}.suite-quick-links{align-self:start;margin-top:43px}}</style>';
  html = replaceOnce(html, '</head>', `${homepagePolish}</head>`, `${locale}: homepage spacing polish`);

  html = updateStructuredData(html, locale);
  writeOutput(relativePath, html);
}

patchHomepage('ru');
patchHomepage('en');

let llms = readFileSync(join(sourceDir, 'llms.txt'), 'utf8');
llms = llms
  .replaceAll('2026-08-27', '2026-08-30')
  .replace('overview of nine TON products.', 'overview of twelve TON and Telegram products.')
  .replace(
    '- [TON BuyBot](https://tonsuite.org/buybot/): Telegram alerts for TON token purchases.',
    '- [TON BuyBot](https://tonsuite.org/buybot/): Telegram alerts for TON token purchases.\n- [TON Generator](https://tonsuite.org/generator/): local W5/v4R2 vanity-address search with a TEP-3 recovery phrase.\n- [TON Changes](https://t.me/tonwebchanges): tracks changes across the TON and Telegram ecosystems.\n- [Web Tracker Robot](https://t.me/webtracker_robot): detects new pages, addresses, and website features before announcements.',
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
    "## TON Generator\n\nCanonical page: https://tonsuite.org/generator/\nSource: https://github.com/rub1kub/ton-vanity-generator\nPurpose: search locally for a chosen ending in a TON W5 or v4R2 friendly address. It uses 12-word BIP39/TEP-3 recovery phrases at m/44'/607'/0', browser Web Workers, and no backend wallet-generation API. Search duration is probabilistic.\n\n## LOOP\n\nURL: https://app.tonsuite.org/\nPurpose: a TON-connected game and one of the four flagship TonSuite products.\n\n## TON Changes\n\nURL: https://t.me/tonwebchanges\nPurpose: tracks changes across the TON and Telegram ecosystems.\n\n## Web Tracker Robot\n\nURL: https://t.me/webtracker_robot\nPurpose: detects new pages, addresses, and website features before official announcements.",
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

const homepageAssets = [
  'ton-changes.png',
  'web-tracker-robot.png',
];
for (const asset of homepageAssets) {
  const destination = join(outputDir, 'assets', 'projects', asset);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  copyFileSync(join('deploy', 'homepage', 'projects', asset), destination);
}

const outputs = [
  `assets/${bundleName}`,
  ...homepageAssets.map((asset) => `assets/projects/${asset}`),
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
