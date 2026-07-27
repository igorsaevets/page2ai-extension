// Page2AI e2e test for the SPA readiness gate (v0.3).
//
// This is an A/B test, not a smoke test. The same client-rendered fixture is
// extracted twice in the same browser:
//
//   control    spaReadinessMode: 'off'   -> must MISS the late content
//   treatment  spaReadinessMode: 'auto'  -> must CAPTURE the late content
//
// Asserting only the treatment would pass even if the gate did nothing and the
// page happened to be fast. Requiring the control to fail is what makes this
// test evidence rather than decoration.
//
// Run:  npx wxt build --mode e2e
//       node .e2e/e2e-spa.mjs

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const EXT_PATH = path.resolve('.output/chrome-mv3-e2e');

// CHROME_PATH first so CI can point at whatever the runner installed; the
// Windows paths stay for local runs on the development machine.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

// The marker text must not exist anywhere in the skeleton, otherwise a control
// run that captured only the skeleton would still "find" it.
const LATE_MARKER = 'LATE-HYDRATED-CONTENT-MARKER';
const RENDER_DELAY_MS = 5000;

const TEST_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Page2AI SPA Fixture</title>
<meta name="description" content="Client-rendered fixture for the SPA readiness gate.">
<style>.skeleton{height:14px;background:#eee;margin:6px 0}</style>
</head>
<body>
<main id="root" aria-busy="true">
  <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
</main>
<script>
  // Deliberately mimics the common shape: an aria-busy shell with skeleton
  // blocks, then a single synchronous swap once "data" arrives. Between load and
  // the swap the DOM is completely quiescent, which is exactly the state that
  // fools a settle-based wait.
  setTimeout(() => {
    const root = document.getElementById('root');
    root.innerHTML = \`
      <h1>Dashboard Overview</h1>
      <p>${LATE_MARKER} rendered on the client after a delay. This paragraph is
      deliberately long enough for the primary content root to clear the
      confidence threshold, because a fixture that stays under it would only ever
      exercise the low-confidence path and would never reach the static
      short-circuit at all.</p>
      <h2>Metrics</h2>
      <table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody><tr><td>Requests</td><td>1,204</td></tr><tr><td>Errors</td><td>3</td></tr></tbody></table>
      <ul><li>First item in the rendered list</li><li>Second item in the rendered list</li></ul>\`;
    root.removeAttribute('aria-busy');
  }, ${RENDER_DELAY_MS});
</script>
</body>
</html>`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('FATAL: Chrome executable not found in standard locations');
  process.exit(2);
}
if (!existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  console.error('FATAL: build output missing — run npx wxt build --mode e2e first');
  process.exit(2);
}

const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(TEST_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/app/dashboard`;
console.log(`test page: ${pageUrl}`);

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    pipe: true,
    enableExtensions: [EXT_PATH],
    args: ['--no-first-run', '--disable-features=ChromeWhatsNewUI'],
  });
}

let browser;
try {
  browser = await launch(true);
} catch (e) {
  console.warn(`headless launch failed (${e.message}); retrying headful`);
  browser = await launch(false);
}

// One extraction run: fresh tab, inject with the given options, wait for the
// background to cache a result. A fresh tab per run matters — the extractor
// keeps a per-tab "already running" flag in the isolated world.
async function runOnce(sw, label, options) {
  const page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

  const tabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const hits = tabs.filter((t) => t.url === url);
    return hits.length ? hits[hits.length - 1].id : null;
  }, pageUrl);
  if (tabId == null) throw new Error(`${label}: no tab`);

  await sw.evaluate(
    async (tabId, opts) => {
      await chrome.storage.session.remove(`result:${tabId}`);
      globalThis.__e2eInjectError = null;
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (key, o) => {
          globalThis[key] = o;
        },
        args: ['__page2aiOptions', opts],
      });
      chrome.scripting
        .executeScript({ target: { tabId }, files: ['/extractor.js'] })
        .catch((e) => {
          globalThis.__e2eInjectError = String(e && e.message ? e.message : e);
        });
    },
    tabId,
    options,
  );

  let cached = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const injectError = await sw.evaluate(() => globalThis.__e2eInjectError ?? null);
    if (injectError) throw new Error(`${label}: injection failed: ${injectError}`);
    cached = await sw.evaluate(async (key) => {
      const stored = await chrome.storage.session.get(key);
      return stored[key] ?? null;
    }, `result:${tabId}`);
    if (cached) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.close();
  if (!cached) throw new Error(`${label}: no result within 60s`);
  return cached.result;
}

try {
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 20000 },
  );
  const sw = await swTarget.worker();
  check('service worker target found', Boolean(sw));

  // --- CONTROL: gate disabled. This is what v1.2.0 shipped. ---
  const control = await runOnce(sw, 'control', {
    profile: 'marketing',
    overrides: { spaReadinessMode: 'off' },
  });
  const controlMd = control.markdown || '';
  // Assert on the STRUCTURED render, not on whether the marker string appears
  // anywhere. The first version of this test checked `!includes(MARKER)` and
  // failed: with the gate off the quality gate notices the render is short and
  // dumps raw body innerText as a "visible text fallback", which by then does
  // contain the hydrated text. So the pre-fix output is not empty — it is
  // unstructured, which is the actual defect and the thing worth asserting.
  check(
    'control (gate off) fails to render the late heading — reproduces the bug',
    !controlMd.includes('# Dashboard Overview'),
    `len=${controlMd.length}`,
  );
  check(
    'control (gate off) fails to render the late table',
    !/\|\s*Metric\s*\|/.test(controlMd),
  );
  check(
    'control degrades to the visible-text fallback',
    controlMd.includes('VISIBLE TEXT FALLBACK'),
  );
  check(
    'control reports the gate as disabled',
    control.spaReadiness?.outcome === 'disabled',
    `outcome=${control.spaReadiness?.outcome}`,
  );

  // --- TREATMENT: gate on auto, the shipped default. ---
  const treatment = await runOnce(sw, 'treatment', {
    profile: 'marketing',
    overrides: { spaMaxWaitMs: 12000 },
  });
  const treatmentMd = treatment.markdown || '';
  check('treatment (gate auto) captures late content', treatmentMd.includes(LATE_MARKER));
  check(
    'treatment engaged the gate',
    treatment.spaReadiness?.engaged === true,
    `engaged=${treatment.spaReadiness?.engaged}`,
  );
  check(
    'treatment reached ready, not timeout',
    treatment.spaReadiness?.outcome === 'ready',
    `outcome=${treatment.spaReadiness?.outcome}`,
  );
  check(
    'treatment waited at least as long as the render delay',
    (treatment.spaReadiness?.waitedMs ?? 0) >= RENDER_DELAY_MS,
    `waitedMs=${treatment.spaReadiness?.waitedMs}`,
  );
  check(
    'treatment did not burn the whole budget',
    (treatment.spaReadiness?.waitedMs ?? 1e9) < 11000,
    `waitedMs=${treatment.spaReadiness?.waitedMs}`,
  );
  check('treatment rendered the late heading', treatmentMd.includes('# Dashboard Overview'));
  check('treatment rendered the late table', /\|\s*Metric\s*\|/.test(treatmentMd));
  check(
    'treatment frontmatter records the wait',
    treatmentMd.includes('client_render_wait: "ready"'),
  );
  check(
    'treatment needs no visible-text fallback',
    !treatmentMd.includes('VISIBLE TEXT FALLBACK'),
  );

  // --- STATIC COST: a server-rendered page must not pay the wait. ---
  // Re-uses the same fixture *after* it has hydrated by extracting a tab that
  // already finished rendering; auto mode should short-circuit to 'static'.
  const warm = await browser.newPage();
  await warm.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS + 400));
  const warmTabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const hits = tabs.filter((t) => t.url === url);
    return hits.length ? hits[hits.length - 1].id : null;
  }, pageUrl);
  await sw.evaluate(
    async (tabId) => {
      await chrome.storage.session.remove(`result:${tabId}`);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (key, o) => {
          globalThis[key] = o;
        },
        args: ['__page2aiOptions', { profile: 'marketing' }],
      });
      chrome.scripting.executeScript({ target: { tabId }, files: ['/extractor.js'] });
    },
    warmTabId,
  );
  let warmResult = null;
  const warmDeadline = Date.now() + 60000;
  while (Date.now() < warmDeadline) {
    const c = await sw.evaluate(async (key) => {
      const s = await chrome.storage.session.get(key);
      return s[key] ?? null;
    }, `result:${warmTabId}`);
    if (c) {
      warmResult = c.result;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await warm.close();
  check(
    'already-rendered page short-circuits to static (no wait cost)',
    warmResult?.spaReadiness?.outcome === 'static',
    `outcome=${warmResult?.spaReadiness?.outcome}`,
  );
  check('already-rendered page still captures content', (warmResult?.markdown || '').includes(LATE_MARKER));

  console.log(`\ncontrol markdown:   ${controlMd.length} chars`);
  console.log(`treatment markdown: ${treatmentMd.length} chars`);
  console.log(`treatment waited:   ${treatment.spaReadiness?.waitedMs} ms`);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
