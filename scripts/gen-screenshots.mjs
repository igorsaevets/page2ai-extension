import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const CHROME_PATH = process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const popupCss = await readFile(resolve(root, 'entrypoints/popup/style.css'), 'utf8');

const shots = [
  {
    slug: 'uscis-eb1',
    url: 'https://www.uscis.gov/working-in-the-united-states/permanent-workers/employment-based-immigration-first-preference-eb-1',
    pageHost: 'uscis.gov',
    popup: {
      profile: 'Marketing',
      statusTone: 'ok',
      statusText: 'Done — Markdown copied to clipboard',
      stats: '18.5 KB · 6 headings · 13 links · marketing',
      log: [
        ['info', 'profile: auto-detected "marketing"'],
        ['info', 'start: profile="marketing"'],
        ['info', 'main: extracted 2 form(s), 3 category tables'],
        ['info', 'done: main=18549, ratio=1.838, OK'],
      ],
      preview: [
        '# Employment-Based Immigration: First Preference EB-1',
        '',
        'You may be eligible for an employment-based, first-preference visa if you',
        'have an extraordinary ability, are an outstanding professor or researcher,',
        'or are a certain multinational executive or manager.',
        '',
        '## Extraordinary Ability',
        '',
        'You must be able to demonstrate extraordinary ability in the sciences,',
        'arts, education, business, or athletics through sustained national or',
        'international acclaim. Your achievements must be recognized in your...',
      ].join('\n'),
    },
  },
  {
    slug: 'openwebui-tools',
    url: 'https://docs.openwebui.com/features/extensibility/plugin/tools/',
    pageHost: 'docs.openwebui.com',
    popup: {
      profile: 'Docs',
      statusTone: 'ok',
      statusText: 'Done — official Markdown used (llms.txt short path)',
      stats: '66.0 KB · docs · official-md (ratio 1.32)',
      log: [
        ['info', 'profile: auto-detected "docs"'],
        ['info', 'llms.txt: discovered tools.md sibling'],
        ['info', 'llms.txt: ratio 1.32 → using official markdown'],
        ['info', 'done: 66049 chars from official .md'],
      ],
      preview: [
        '# Tools',
        '',
        'Tools are Python scripts that extend the capabilities of LLMs in',
        'Open WebUI. They can be called by the model to perform tasks like',
        'web searches, data retrieval, or custom computations.',
        '',
        '## Installing a Tool',
        '',
        '1. Navigate to **Workspace** → **Tools**',
        '2. Click the **+ New Tool** button',
        '3. Paste your Python tool code',
        '4. Click **Save**',
      ].join('\n'),
    },
  },
  {
    slug: 'xai-grok-45',
    url: 'https://docs.x.ai/developers/models/grok-4.5',
    pageHost: 'docs.x.ai',
    popup: {
      profile: 'Docs',
      statusTone: 'ok',
      statusText: 'Done — Markdown copied to clipboard',
      stats: '10.4 KB · 1 code tab captured · 8 headings',
      log: [
        ['info', 'profile: auto-detected "docs"'],
        ['info', 'start: profile="docs"'],
        ['info', 'tabs: discovered 1 tab group'],
        ['info', 'tabs: captured code panel "cURL"'],
        ['info', 'done: main=10420, ratio=2.915'],
      ],
      preview: [
        '# grok-4.5',
        '',
        'Grok 4.5 is xAI\'s most advanced reasoning model, optimized for',
        'complex tasks involving long-context understanding, tool use,',
        'and multi-step reasoning.',
        '',
        '## Endpoints',
        '',
        '```bash',
        'curl https://api.x.ai/v1/chat/completions \\',
        '  -H "Authorization: Bearer $XAI_API_KEY" \\',
        '  -H "Content-Type: application/json"',
        '```',
      ].join('\n'),
    },
  },
];

function popupHtml(pageHost, mock) {
  const logLis = mock.log
    .map(([lvl, msg]) => `<li data-level="${lvl}">${escapeHtml(msg)}</li>`)
    .join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: transparent; }
${popupCss}
/* screenshot-only overrides: force expanded state, no scrollbars */
.log { display: block !important; }
.log ul { max-height: none; }
.result { display: flex !important; }
.preview[open] textarea { height: 170px; }
</style></head>
<body>
  <main class="popup">
    <header class="header">
      <div class="brand">
        <span class="logo" aria-hidden="true">M&darr;</span>
        <h1>Page2AI</h1>
        <span class="version">v1.0.0</span>
      </div>
      <div class="page-host" title="${pageHost}">${pageHost}</div>
    </header>
    <section class="controls">
      <label class="field">
        <span class="field-label">Profile</span>
        <select><option>${mock.profile}</option></select>
      </label>
      <button class="btn primary">Extract Markdown</button>
    </section>
    <div class="status" data-tone="${mock.statusTone}">${escapeHtml(mock.statusText)}</div>
    <details class="log" open>
      <summary>Progress log (${mock.log.length})</summary>
      <ul>${logLis}</ul>
    </details>
    <section class="result">
      <div class="stats">${escapeHtml(mock.stats)}</div>
      <div class="actions">
        <button class="btn primary">Copy</button>
        <button class="btn">Download .md</button>
      </div>
      <details class="preview" open>
        <summary>Preview</summary>
        <textarea readonly>${escapeHtml(mock.preview)}</textarea>
      </details>
    </section>
  </main>
</body></html>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const outDir = resolve(root, 'assets/store');
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--font-render-hinting=none'],
  defaultViewport: { width: 1280, height: 800 },
});
try {
  let idx = 0;
  for (const shot of shots) {
    idx += 1;
    console.log(`--- [${idx}/${shots.length}] ${shot.slug}`);
    // 1) base: real webpage
    const pagePage = await browser.newPage();
    await pagePage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    try {
      await pagePage.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await pagePage
        .waitForNetworkIdle({ idleTime: 500, timeout: 8000 })
        .catch(() => undefined);
    } catch (e) {
      console.log(`  nav soft-error: ${e.message}`);
    }
    const baseBuf = await pagePage.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 800 } });
    await pagePage.close();

    // 2) popup mockup at 2x
    const popupPage = await browser.newPage();
    await popupPage.setViewport({ width: 400, height: 700, deviceScaleFactor: 2 });
    await popupPage.setContent(popupHtml(shot.pageHost, shot.popup), { waitUntil: 'load' });
    await popupPage.evaluateHandle('document.fonts.ready');
    const popupClipHeight = await popupPage.evaluate(() => {
      const main = document.querySelector('.popup');
      return Math.min(680, Math.ceil(main.getBoundingClientRect().height + 24));
    });
    const popupBuf2x = await popupPage.screenshot({
      type: 'png',
      omitBackground: true,
      clip: { x: 0, y: 0, width: 380, height: popupClipHeight },
    });
    await popupPage.close();

    // downsample popup 2x → 1x, add shadow via sharp
    const popupWidth = 380;
    const popupHeight = popupClipHeight;
    const popupBuf = await sharp(popupBuf2x)
      .resize(popupWidth, popupHeight, { fit: 'fill' })
      .png()
      .toBuffer();

    // 3) compose: base + popup top-right with margin + soft shadow
    const marginTop = 24;
    const marginRight = 32;
    const left = 1280 - popupWidth - marginRight;
    const top = marginTop;

    // Create a shadow layer: a slightly larger dark blurred rect below popup
    const shadowPad = 16;
    const shadow = await sharp({
      create: {
        width: popupWidth + shadowPad * 2,
        height: popupHeight + shadowPad * 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.28 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: popupWidth,
              height: popupHeight,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0.55 },
            },
          }).png().toBuffer(),
          top: shadowPad,
          left: shadowPad,
        },
      ])
      .blur(12)
      .png()
      .toBuffer();

    const composed = await sharp(baseBuf)
      .composite([
        { input: shadow, top: top - shadowPad + 6, left: left - shadowPad },
        { input: popupBuf, top, left },
      ])
      .png({ compressionLevel: 9 })
      .toFile(resolve(outDir, `screenshot-${idx}-${shot.slug}-1280x800.png`));
    console.log(`  ok ${composed.width}x${composed.height} → screenshot-${idx}-${shot.slug}-1280x800.png`);
  }
} finally {
  await browser.close();
}
