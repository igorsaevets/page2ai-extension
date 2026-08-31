// Page2AI dev utility: extract any live URL through the REAL extension pipeline —
// built extension loaded into real Chrome, extraction triggered by the same
// two-step executeScript sequence the background performs, result read from
// storage.session. Saves markdown + quality meta + the rendered page's innerText
// (captured BEFORE injection, as a ground-truth reference for fidelity checks).
//
// Run:  npx wxt build --mode real-test
//       node .e2e/extract-url.mjs --out <dir> <url> [<url>...]
//
// Not a test suite: exits 0 iff every URL produced a cached result.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const EXT_PATH = path.resolve('.output/chrome-mv3-real-test');

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
let outDir = '.e2e/out';
// en-US by default so results do not depend on the machine locale: Google
// serves machine-translated pages (ru-x-mtfrom-en) to a ru-RU browser.
let lang = 'en-US';
const urls = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    outDir = args[++i];
    continue;
  }
  if (args[i] === '--lang') {
    lang = args[++i];
    continue;
  }
  urls.push(args[i]);
}
if (!urls.length) {
  console.error('usage: node .e2e/extract-url.mjs [--out <dir>] [--lang <bcp47>] <url> [<url>...]');
  process.exit(2);
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('FATAL: Chrome executable not found in standard locations');
  process.exit(2);
}
if (!existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  console.error('FATAL: build output missing — run npx wxt build --mode real-test first');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const slugOf = (u) => {
  const { hostname, pathname } = new URL(u);
  return (hostname.replace(/^www\./, '') + pathname)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    // Pipe transport is reliable on Windows and dies on GitHub's Linux runners
    // the moment an extension is loaded; WebSocket works on both.
    pipe: process.platform === 'win32',
    enableExtensions: [EXT_PATH],
    args: [
      '--no-first-run',
      '--disable-features=ChromeWhatsNewUI',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--lang=${lang}`,
      `--accept-lang=${lang}`,
    ],
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
  for (const url of urls) {
    const started = Date.now();
    const slug = slugOf(url);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    try {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      } catch (e) {
        console.warn(`goto settle timed out for ${url} (${e.message}); continuing with current DOM`);
      }
      await new Promise((r) => setTimeout(r, 1500));

      const finalUrl = page.url();
      // Ground truth before injection: tab capture clicks through tab groups,
      // so innerText taken afterwards would not be the page as delivered.
      const truth = await page.evaluate(() => ({
        title: document.title,
        innerText: document.body ? document.body.innerText : '',
      }));

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

      // Same two-step injection the background performs. Also accumulate the
      // extractor's PAGE2AI_PROGRESS stream — saved next to the markdown, it is
      // the only record of which capture paths fired on a live page.
      await sw.evaluate(async (tabId) => {
        globalThis.__e2eInjectError = null;
        globalThis.__e2eProgress = [];
        if (!globalThis.__e2eProgressListener) {
          globalThis.__e2eProgressListener = (m) => {
            if (m && m.type === 'PAGE2AI_PROGRESS') {
              globalThis.__e2eProgress.push(`[${m.step}]${m.level === 'warn' ? ' ⚠' : ''} ${m.message}`);
            }
          };
          chrome.runtime.onMessage.addListener(globalThis.__e2eProgressListener);
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
            globalThis.__e2eInjectError = String(e && e.message ? e.message : e);
          });
      }, tabId);

      let cached = null;
      // Real docs pages with many tab groups can legitimately spend most of the
      // 60s tab-phase budget before rendering starts.
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const injectError = await sw.evaluate(() => globalThis.__e2eInjectError ?? null);
        if (injectError) throw new Error(`injection failed: ${injectError}`);
        cached = await sw.evaluate(async (key) => {
          const stored = await chrome.storage.session.get(key);
          return stored[key] ?? null;
        }, `result:${tabId}`);
        if (cached) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cached) throw new Error('no cached result within 90s');

      const { result } = cached;
      const md = result.markdown || '';
      const progressLines = await sw
        .evaluate(() => globalThis.__e2eProgress ?? [])
        .catch(() => []);
      writeFileSync(path.join(outDir, `${slug}.md`), md, 'utf8');
      writeFileSync(path.join(outDir, `${slug}.innertext.txt`), truth.innerText, 'utf8');
      writeFileSync(path.join(outDir, `${slug}.progress.txt`), progressLines.join('\n'), 'utf8');
      writeFileSync(
        path.join(outDir, `${slug}.meta.json`),
        JSON.stringify(
          {
            url,
            finalUrl,
            documentTitle: truth.title,
            status: result.status,
            profile: result.profile,
            quality: result.quality ?? null,
            tabsCaptured: result.tabsCaptured ?? 0,
            filename: result.filename ?? null,
            mdChars: md.length,
            innerTextChars: truth.innerText.length,
            elapsedMs: Date.now() - started,
          },
          null,
          2,
        ),
        'utf8',
      );
      console.log(
        `OK    ${url} -> ${slug}.md (${md.length} chars, profile=${result.profile}, status=${result.status}, ${Date.now() - started}ms)`,
      );
    } catch (e) {
      failures++;
      console.error(`FAIL  ${url} — ${e.message}`);
    } finally {
      await page.close().catch(() => {});
    }
    if (urls.indexOf(url) < urls.length - 1) {
      // Politeness between live fetches; varied, never metronomic.
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 6000));
    }
  }
} finally {
  await browser.close().catch(() => {});
}

process.exit(failures ? 1 : 0);
