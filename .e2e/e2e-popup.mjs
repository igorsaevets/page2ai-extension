// Page2MD popup e2e: exercises the real user flow — toolbar click opens the
// popup, Extract runs against a fixture tab, the result renders, and a
// re-opened popup recovers the cached result from storage.session.
//
// Run:  npm i --no-save puppeteer-core
//       npx wxt build --mode e2e
//       node .e2e/e2e-popup.mjs

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const EXT_PATH = path.resolve('.output/chrome-mv3-e2e');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];

const TEST_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Page2MD Popup Fixture</title>
<meta name="description" content="Fixture for the popup e2e test."></head>
<body>
<main>
  <h1>Getting Started</h1>
  <p>Some <strong>content</strong> with a <a href="https://example.com/x">link</a>.</p>
  <pre><code>npm install page2md</code></pre>
  <ul><li>Alpha</li><li>Beta</li></ul>
</main>
</body>
</html>`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath || !existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  console.error('FATAL: chrome or e2e build output missing');
  process.exit(2);
}

const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(TEST_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/docs/popup-fixture`;

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    pipe: true,
    enableExtensions: [EXT_PATH],
    args: ['--no-first-run'],
  });
}

let browser;
try {
  browser = await launch(true);
} catch (e) {
  console.warn(`headless launch failed (${e.message}); retrying headful`);
  browser = await launch(false);
}

const openPopup = async (page, ext) => {
  await page.bringToFront();
  await page.triggerExtensionAction(ext);
  const target = await browser.waitForTarget(
    (t) => t.type() === 'page' && t.url().includes('popup.html'),
    { timeout: 10000 },
  );
  const popup = (await target.page()) ?? (await target.asPage());
  // Wait for async init() to finish (version filled + button state settled).
  await popup.waitForFunction(
    () => document.querySelector('#version')?.textContent?.startsWith('v'),
    { timeout: 5000 },
  );
  return popup;
};

try {
  const page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: 'load' });

  const extensions = await browser.extensions();
  const ext = [...extensions.values()][0];
  check('extension registered', Boolean(ext), ext?.id);

  // --- First popup: run a full extraction ---
  const popup = await openPopup(page, ext);
  check('popup opened', Boolean(popup), popup.url());

  const host = await popup.$eval('#page-host', (n) => n.textContent);
  check('popup shows page host', host === '127.0.0.1', `host=${host}`);

  const disabled = await popup.$eval('#extract', (n) => n.disabled);
  check('extract button enabled', !disabled);

  await popup.click('#extract');
  await popup.waitForFunction(
    () => !document.querySelector('#result')?.hidden,
    { timeout: 90000, polling: 300 },
  );
  const stats = await popup.$eval('#stats', (n) => n.textContent);
  const status = await popup.$eval('#status', (n) => `${n.dataset.tone}: ${n.textContent}`);
  const preview = await popup.$eval('#preview-text', (n) => n.value);
  const logCount = await popup.$eval('#log-count', (n) => Number(n.textContent));

  check('stats mention docs profile', /profile: docs/.test(stats ?? ''), stats ?? '');
  check('markdown preview has h1', preview.includes('# Getting Started'));
  check('markdown preview has fence', preview.includes('```'));
  check('progress log populated', logCount > 0, `${logCount} entries`);
  check(
    'final status is ok/warn (copied or copy-hint)',
    /^(ok|warn):/.test(status ?? ''),
    status ?? '',
  );

  // --- Second popup: cached-result recovery ---
  await popup.close();
  const popup2 = await openPopup(page, ext);
  await popup2.waitForFunction(
    () => !document.querySelector('#result')?.hidden,
    { timeout: 5000, polling: 200 },
  );
  const status2 = await popup2.$eval('#status', (n) => n.textContent);
  const preview2 = await popup2.$eval('#preview-text', (n) => n.value);
  check('reopened popup recovers cached result', preview2.includes('# Getting Started'));
  check(
    'cached status says previous extraction',
    (status2 ?? '').includes('previous extraction'),
    status2 ?? '',
  );
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
