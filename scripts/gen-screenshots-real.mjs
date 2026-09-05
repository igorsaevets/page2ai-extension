// Fresh Chrome Web Store screenshots (1280×800) using REAL extension execution.
//
// Combines .e2e/extract-url.mjs (real extension → real stats via storage.session)
// with scripts/gen-screenshots.mjs (mock-popup composition on a live-page capture),
// so the popup renders the actual profile / chars / tabs / quality returned by the
// extension on today's version of each page — no hardcoded numbers.
//
// Run:  npx wxt build --mode real-test
//       node scripts/gen-screenshots-real.mjs [--out assets/store]

import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const EXT_PATH = path.resolve(root, '.output/chrome-mv3-real-test');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

const args = process.argv.slice(2);
let outDir = path.resolve(root, 'assets/store');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = path.resolve(args[++i]);
}

const shots = [
  {
    slug: 'uscis-eb1',
    url: 'https://www.uscis.gov/working-in-the-united-states/permanent-workers/employment-based-immigration-first-preference-eb-1',
    pageHost: 'uscis.gov',
    // First lines of the extracted markdown that make a compelling preview
    previewHeadRe: /^# [^\n]+.{0,600}/s,
  },
  {
    slug: 'openwebui-tools',
    url: 'https://docs.openwebui.com/features/extensibility/plugin/tools/',
    pageHost: 'docs.openwebui.com',
    previewHeadRe: /^# [^\n]+.{0,600}/s,
  },
  {
    slug: 'xai-grok-45',
    url: 'https://docs.x.ai/docs/models',
    pageHost: 'docs.x.ai',
    previewHeadRe: /^# [^\n]+.{0,600}/s,
  },
];

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('FATAL: Chrome executable not found. Set CHROME_PATH env var.');
  process.exit(2);
}
if (!existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  console.error(`FATAL: ${EXT_PATH}/manifest.json missing — run:  npx wxt build --mode real-test`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const popupCss = await readFile(path.resolve(root, 'entrypoints/popup/style.css'), 'utf8');

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatBytes(n) {
  if (n >= 100_000) return `${(n / 1024).toFixed(0)} KB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtProfile(p) {
  const m = { docs: 'Docs', marketing: 'Marketing', research: 'Research', dashboard: 'Dashboard', 'wordpress-marketing': 'WordPress' };
  return m[p] || (p ? p[0].toUpperCase() + p.slice(1) : 'Auto');
}

function buildStatus(result) {
  if (result.status === 'official-md') {
    return {
      tone: 'ok',
      text: `Done — official Markdown used${result.officialMarkdownRatio ? ` (ratio ${result.officialMarkdownRatio.toFixed(2)})` : ''}`,
    };
  }
  return { tone: 'ok', text: 'Done — Markdown copied to clipboard' };
}

function buildStats(result, mdChars) {
  const parts = [formatBytes(mdChars)];
  if (result.tabsCaptured) parts.push(`${result.tabsCaptured} tab${result.tabsCaptured === 1 ? '' : 's'} captured`);
  if (result.dropdownsCaptured) parts.push(`${result.dropdownsCaptured} dropdown${result.dropdownsCaptured === 1 ? '' : 's'}`);
  if (result.status === 'official-md') parts.push('official-md');
  else parts.push(String(result.profile || 'auto'));
  if (result.quality && typeof result.quality.ratio === 'number') {
    parts.push(`ratio ${result.quality.ratio.toFixed(2)}`);
  }
  return parts.join(' · ');
}

function buildLog(result, progressLines) {
  // Pick 3-4 characteristic lines out of progress that read well
  const kept = [];
  const seen = new Set();
  const push = (level, msg) => {
    const key = msg.slice(0, 60);
    if (seen.has(key)) return;
    seen.add(key);
    kept.push([level, msg]);
  };
  push('info', `profile: auto-detected "${result.profile}"`);
  for (const line of progressLines) {
    if (kept.length >= 5) break;
    // Progress lines look like: "[step] message" or "[step] ⚠ message"
    const m = line.match(/^\[([^\]]+)\](?: ⚠)? (.+)$/);
    if (!m) continue;
    const [, step, msg] = m;
    if (step === 'inject-error' || step === 'busy') continue;
    if (step === 'start' || step === 'llmstxt' || step === 'main' || step === 'tabs' || step === 'done') {
      push('info', `${step}: ${msg.slice(0, 90)}`);
    }
  }
  if (kept.length < 3) {
    push('info', `done: ${formatBytes(result.markdown?.length || 0)}`);
  }
  return kept.slice(0, 5);
}

function popupHtml({ pageHost, profile, status, stats, log, preview }) {
  const logLis = log
    .map(([lvl, msg]) => `<li data-level="${lvl}">${escapeHtml(msg)}</li>`)
    .join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: transparent; }
${popupCss}
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
        <span class="version">v1.3.0</span>
      </div>
      <div class="page-host" title="${escapeHtml(pageHost)}">${escapeHtml(pageHost)}</div>
    </header>
    <section class="controls">
      <label class="field">
        <span class="field-label">Profile</span>
        <select><option>${escapeHtml(profile)}</option></select>
      </label>
      <button class="btn primary">Extract Markdown</button>
    </section>
    <div class="status" data-tone="${escapeHtml(status.tone)}">${escapeHtml(status.text)}</div>
    <details class="log" open>
      <summary>Progress log (${log.length})</summary>
      <ul>${logLis}</ul>
    </details>
    <section class="result">
      <div class="stats">${escapeHtml(stats)}</div>
      <div class="actions">
        <button class="btn primary">Copy</button>
        <button class="btn">Download .md</button>
      </div>
      <details class="preview" open>
        <summary>Preview</summary>
        <textarea readonly>${escapeHtml(preview)}</textarea>
      </details>
    </section>
  </main>
</body></html>`;
}

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    pipe: process.platform === 'win32',
    enableExtensions: [EXT_PATH],
    args: [
      '--no-first-run',
      '--disable-features=ChromeWhatsNewUI',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--lang=en-US',
      '--accept-lang=en-US',
      '--font-render-hinting=none',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
}

let browser;
try {
  browser = await launch(true);
} catch (e) {
  console.warn(`headless launch failed (${e.message}); retrying headful`);
  browser = await launch(false);
}

let failures = 0;
try {
  let idx = 0;
  for (const shot of shots) {
    idx += 1;
    const started = Date.now();
    console.log(`--- [${idx}/${shots.length}] ${shot.slug} — ${shot.url}`);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

    let baseBuf;
    let realStats = null;
    let realProfile = 'Auto';
    let realStatus = { tone: 'ok', text: 'Done — Markdown copied to clipboard' };
    let realLog = [['info', 'start']];
    let realPreview = '';

    try {
      try {
        await page.goto(shot.url, { waitUntil: 'networkidle2', timeout: 45000 });
      } catch (e) {
        console.warn(`  nav soft-error: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));

      const finalUrl = page.url();
      baseBuf = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: 1280, height: 800 },
      });

      const swTarget = await browser.waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
        { timeout: 20000 },
      );
      const sw = await swTarget.worker();

      const tabId = await sw.evaluate(async (wanted) => {
        const tabs = await chrome.tabs.query({});
        const exact = tabs.find((t) => t.url === wanted);
        if (exact) return exact.id;
        const origin = new URL(wanted).origin;
        return tabs.find((t) => (t.url || '').startsWith(origin))?.id ?? null;
      }, finalUrl);
      if (tabId == null) throw new Error('tab not visible from service worker');

      await sw.evaluate(async (tabId) => {
        globalThis.__ssInjectError = null;
        globalThis.__ssProgress = [];
        if (!globalThis.__ssProgressListener) {
          globalThis.__ssProgressListener = (m) => {
            if (m && m.type === 'PAGE2AI_PROGRESS') {
              globalThis.__ssProgress.push(`[${m.step}]${m.level === 'warn' ? ' ⚠' : ''} ${m.message}`);
            }
          };
          chrome.runtime.onMessage.addListener(globalThis.__ssProgressListener);
        }
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (key, opts) => {
            globalThis[key] = opts;
          },
          args: ['__page2aiOptions', { profile: 'auto' }],
        });
        chrome.scripting
          .executeScript({ target: { tabId }, files: ['/extractor.js'] })
          .catch((e) => {
            globalThis.__ssInjectError = String(e && e.message ? e.message : e);
          });
      }, tabId);

      let cached = null;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const injectError = await sw.evaluate(() => globalThis.__ssInjectError ?? null);
        if (injectError) throw new Error(`injection failed: ${injectError}`);
        cached = await sw.evaluate(async (key) => {
          const stored = await chrome.storage.session.get(key);
          return stored[key] ?? null;
        }, `result:${tabId}`);
        if (cached) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cached) throw new Error('no cached result within 180s');

      const { result } = cached;
      const md = result.markdown || '';
      const progressLines = await sw.evaluate(() => globalThis.__ssProgress ?? []).catch(() => []);

      realProfile = fmtProfile(result.profile);
      realStatus = buildStatus(result);
      realStats = buildStats(result, md.length);
      realLog = buildLog(result, progressLines);

      // Prefer the first-heading block as preview; strip HTML-y noise if any
      const previewMatch = md.match(shot.previewHeadRe);
      realPreview = (previewMatch ? previewMatch[0] : md.slice(0, 600)).trimEnd();
      // Truncate to something that fits nicely in the popup textarea
      if (realPreview.length > 520) realPreview = realPreview.slice(0, 520).replace(/\s+\S*$/, '') + '\n...';

      console.log(`  extract OK: profile=${result.profile} status=${result.status} chars=${md.length} tabs=${result.tabsCaptured || 0} elapsed=${Date.now() - started}ms`);
    } catch (e) {
      failures++;
      console.error(`  FAIL ${shot.url} — ${e.message}`);
      // We still have baseBuf usually; if not, skip compositing
      if (!baseBuf) {
        await page.close().catch(() => {});
        continue;
      }
      // Fall back to a plain "loading" popup if extraction failed
      realStats = 'extraction unavailable';
      realStatus = { tone: 'warn', text: 'Live capture failed — preview omitted' };
      realLog = [['info', `nav: ${new URL(shot.url).hostname}`], ['warn', 'extraction did not complete']];
      realPreview = '(fresh capture unavailable at build time)';
    }

    // Compose base + popup + soft shadow (same recipe as gen-screenshots.mjs)
    const popupPage = await browser.newPage();
    await popupPage.setViewport({ width: 400, height: 700, deviceScaleFactor: 2 });
    await popupPage.setContent(
      popupHtml({
        pageHost: shot.pageHost,
        profile: realProfile,
        status: realStatus,
        stats: realStats || 'auto',
        log: realLog,
        preview: realPreview,
      }),
      { waitUntil: 'load' },
    );
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

    const popupWidth = 380;
    const popupHeight = popupClipHeight;
    const popupBuf = await sharp(popupBuf2x)
      .resize(popupWidth, popupHeight, { fit: 'fill' })
      .png()
      .toBuffer();

    const marginTop = 24;
    const marginRight = 32;
    const left = 1280 - popupWidth - marginRight;
    const top = marginTop;

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
          })
            .png()
            .toBuffer(),
          top: shadowPad,
          left: shadowPad,
        },
      ])
      .blur(12)
      .png()
      .toBuffer();

    const outPath = path.resolve(outDir, `screenshot-${idx}-${shot.slug}-1280x800.png`);
    const composed = await sharp(baseBuf)
      .composite([
        { input: shadow, top: top - shadowPad + 6, left: left - shadowPad },
        { input: popupBuf, top, left },
      ])
      .png({ compressionLevel: 9 })
      .toFile(outPath);

    console.log(`  ok ${composed.width}x${composed.height} → ${path.relative(root, outPath)}`);

    await page.close().catch(() => {});
  }
} finally {
  await browser.close();
  if (failures > 0) {
    console.error(`\n${failures} shot(s) had extraction failures — pages captured but popup shows warning`);
    process.exit(1);
  }
  console.log(`\nall ${shots.length} screenshots regenerated with REAL extraction stats`);
}
