// Page2AI e2e: URL drift during tab capture must never kill the extraction (#10).
//
// Two fixtures, one per drift style:
//   /replace-drift — tab clicks mutate the hash via history.replaceState (no new
//                    history entry). This is the ai.google.dev/devsite pattern:
//                    history.back() here leaves the page entirely and destroys
//                    the content script mid-run.
//   /push-drift    — tab clicks assign location.hash (pushes an entry), the
//                    style the old history.back() restore was written for.
//
// Both must finish extraction, capture BOTH tab panels, and leave the tab on
// the fixture URL.
//
// Run:  npm i --no-save puppeteer-core
//       npx wxt build --mode e2e
//       node .e2e/e2e-url-drift.mjs

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const EXT_PATH = path.resolve('.output/chrome-mv3-e2e');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

const fixture = (driftJs) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Drift Fixture</title></head>
<body>
<main>
  <h1>Drift Fixture Article</h1>
  <p>Prose before the tab group so the page has real content.</p>
  <div role="tablist" aria-label="Language">
    <button role="tab" id="tab-alpha" aria-selected="true" aria-controls="panel-alpha">Alpha</button>
    <button role="tab" id="tab-bravo" aria-selected="false" aria-controls="panel-bravo">Bravo</button>
  </div>
  <div role="tabpanel" id="panel-alpha" aria-labelledby="tab-alpha">REPLACE-ALPHA-PANEL-MARKER visible by default.</div>
  <div role="tabpanel" id="panel-bravo" aria-labelledby="tab-bravo" hidden>REPLACE-BRAVO-PANEL-MARKER behind the second tab.</div>
  <p>Prose after the group.</p>
</main>
<script>
  const tabs = [['tab-alpha','panel-alpha','alpha'],['tab-bravo','panel-bravo','bravo']];
  for (const [tabId, panelId, frag] of tabs) {
    document.getElementById(tabId).addEventListener('click', () => {
      for (const [t, p] of tabs) {
        document.getElementById(t).setAttribute('aria-selected', String(t === tabId));
        document.getElementById(p).hidden = p !== panelId;
      }
      ${driftJs}
    });
  }
</script>
</body>
</html>`;

// replace-drift: the devsite pattern — the URL changes but NO history entry is
// pushed, so a history.back() "restore" navigates out of the page.
const REPLACE_FIXTURE = fixture(`history.replaceState(null, '', location.pathname + '#' + frag);`);
// push-drift: plain hash assignment pushes an entry.
const PUSH_FIXTURE = fixture(`location.hash = frag;`);

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
  res.end(req.url.startsWith('/push-drift') ? PUSH_FIXTURE : REPLACE_FIXTURE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

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

try {
  for (const name of ['replace-drift', 'push-drift']) {
    const pageUrl = `http://127.0.0.1:${port}/${name}`;
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: 'load' });

    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
      { timeout: 20000 },
    );
    const sw = await swTarget.worker();

    const tabId = await sw.evaluate(async (wanted) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url === wanted)?.id ?? null;
    }, pageUrl);
    check(`${name}: test tab visible from SW`, tabId != null, `tabId=${tabId}`);
    if (tabId == null) {
      await page.close().catch(() => {});
      continue;
    }

    await sw.evaluate(async (tabId) => {
      globalThis.__e2eInjectError = null;
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
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const injectError = await sw.evaluate(() => globalThis.__e2eInjectError ?? null);
      if (injectError) break;
      cached = await sw.evaluate(async (key) => {
        const stored = await chrome.storage.session.get(key);
        return stored[key] ?? null;
      }, `result:${tabId}`);
      if (cached) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    check(`${name}: extraction completed (result cached)`, Boolean(cached));
    const md = cached?.result?.markdown || '';
    check(`${name}: status ok`, cached?.result?.status === 'ok', `status=${cached?.result?.status}`);
    check(`${name}: visible panel captured`, md.includes('REPLACE-ALPHA-PANEL-MARKER'));
    check(`${name}: hidden panel captured via tab click`, md.includes('REPLACE-BRAVO-PANEL-MARKER'));

    const tabUrl = await sw.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).url, tabId);
    check(
      `${name}: tab still on the fixture page (no navigation escape)`,
      typeof tabUrl === 'string' && tabUrl.startsWith(`http://127.0.0.1:${port}/${name}`),
      tabUrl,
    );

    await page.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
