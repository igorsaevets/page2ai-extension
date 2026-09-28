// Page2AI e2e suite for issues #11 and #12.
//
//  #11 — visible tab-panel content must never be dropped:
//  /dup-ids       — two widgets reuse the SAME panel ids (devsite does this),
//                   and their code samples share the first/last 200 chars.
//                   Pre-fix, aria-controls resolved to widget 1's panel for
//                   both widgets and the head/tail signature called different
//                   content "duplicate"; widget 2's content vanished. Both
//                   unique middles must survive.
//  /true-dup      — two widgets with byte-identical panels: content exports
//                   once, the second location says WHY it is skipped (marker),
//                   never silently.
//  /toolbar       — copy/theme buttons inside <pre> and a feedback widget are
//                   chrome, not tabs: they must not be discovered as tab
//                   groups and — the live-usage bug — must NOT be clicked (a
//                   real theme toggle persists the reader's site preference).
//  /oversize      — a panel too large to relocate under its button is left in
//                   place IN FULL rather than exported truncated.
//
//  #12 — ordinary page buttons are not tabs (T96 audit repro):
//  /actions-in-main — Like/Bookmark and Vietnamese Xóa/Đăng ký live inside
//                   <main>, outside any tablist/nav/form/pre wrapper. Pre-fix
//                   the "all elements are <button>" shortcut classified them
//                   as tab groups and clicked them during extraction. After
//                   the fix, none is clicked and no [Tab Button: …] marker is
//                   emitted for them; a genuine ARIA tab widget on the same
//                   page is still captured.
//  /legacy-tabs   — an ancient jQuery UI shape: two buttons with no ARIA at
//                   all, wrapped in a container with class="nav-tabs". The
//                   safety fix must not drop widgets that declare themselves
//                   via CSS convention rather than ARIA.
//
// Run:  npm i --no-save puppeteer-core
//       npx wxt build --mode e2e
//       node .e2e/e2e-tab-panels.mjs

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

// --- fixtures ---------------------------------------------------------------

// Shared code head/tail long enough to swallow the old 200-char signature
// window on both ends; the middle is what distinguishes the panels.
const HEAD = 'import boilerplate\n'.repeat(15); // ~270 chars
const TAIL = 'print(shared_epilogue)\n'.repeat(12); // ~276 chars

const tabWidget = (widgetClass, tabs) => `
<div class="${widgetClass} widget">
  <div role="tablist">
    ${tabs
      .map(
        (t, i) =>
          `<button role="tab" aria-controls="${t.panelId}" aria-selected="${i === 0 ? 'true' : 'false'}">${t.label}</button>`,
      )
      .join('\n    ')}
  </div>
  ${tabs
    .map(
      (t, i) =>
        `<section role="tabpanel" id="${t.panelId}"${i === 0 ? '' : ' hidden'}><pre><code>${t.code}</code></pre></section>`,
    )
    .join('\n  ')}
</div>`;

const WIDGET_SCRIPT = `
<script>
  // Sane per-widget tab switching, scoped the way real sites scope it — which
  // is exactly why duplicate ids across widgets work fine for the PAGE and
  // break a document-wide getElementById.
  document.querySelectorAll('.widget').forEach((w) => {
    w.querySelectorAll('[role="tab"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        w.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        w.querySelectorAll('[role="tabpanel"]').forEach((p) => {
          if (p.id === btn.getAttribute('aria-controls')) p.removeAttribute('hidden');
          else p.setAttribute('hidden', '');
        });
      });
    });
  });
</script>`;

const page = (title, body) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body><main><h1>${title}</h1>
<p>Fixture body for the tab-panels suite; long enough to render.</p>
${body}</main>${WIDGET_SCRIPT}</body></html>`;

const FIXTURES = {
  // Devsite shape: both widgets use id="panel-python" / id="panel-js".
  '/dup-ids': page(
    'Duplicate Panel Ids',
    `<h2>First topic</h2>
     ${tabWidget('g1', [
       { label: 'Python', panelId: 'panel-python', code: `${HEAD}G1_PYTHON_UNIQUE_MIDDLE\n${TAIL}` },
       { label: 'JavaScript', panelId: 'panel-js', code: `${HEAD}G1_JS_UNIQUE_MIDDLE\n${TAIL}` },
     ])}
     <h2>Second topic</h2>
     ${tabWidget('g2', [
       { label: 'Python', panelId: 'panel-python', code: `${HEAD}G2_PYTHON_UNIQUE_MIDDLE\n${TAIL}` },
       { label: 'JavaScript', panelId: 'panel-js', code: `${HEAD}G2_JS_UNIQUE_MIDDLE\n${TAIL}` },
     ])}`,
  ),
  '/true-dup': page(
    'True Duplicate Panels',
    `<h2>Install (npm)</h2>
     ${tabWidget('g1', [
       { label: 'Shell', panelId: 'dup-shell-1', code: `${HEAD}TRUE_DUP_PAYLOAD\n${TAIL}` },
       { label: 'Other', panelId: 'dup-other-1', code: `${HEAD}OTHER_PAYLOAD_ONE\n${TAIL}` },
     ])}
     <h2>Install (repeated verbatim)</h2>
     ${tabWidget('g2', [
       { label: 'Shell', panelId: 'dup-shell-2', code: `${HEAD}TRUE_DUP_PAYLOAD\n${TAIL}` },
       { label: 'Other', panelId: 'dup-other-2', code: `${HEAD}OTHER_PAYLOAD_TWO\n${TAIL}` },
     ])}`,
  ),
  '/toolbar': page(
    'Toolbar Chrome',
    `<h2>Sample with toolbar</h2>
     <pre><div class="code-buttons">
       <button type="button" onclick="window.__themeClicks=(window.__themeClicks||0)+1">Dark code theme</button>
       <button type="button" onclick="window.__copyClicks=(window.__copyClicks||0)+1">Copy code sample</button>
     </div><code>TOOLBAR_CODE_PAYLOAD line one
line two of the sample</code></pre>
     <!-- The LIVE devsite shape, measured on ai.google.dev 2026-08-31: thumbs
          under <devsite-thumb-rating>, no "feedback" substring anywhere. The
          first fix tested a made-up class and missed this (panel review). -->
     <devsite-thumb-rating>
       <div class="devsite-thumb-rating"><p>Was this helpful?</p><div class="devsite-thumbs">
         <button type="button" class="devsite-thumb devsite-thumb-up" aria-label="Helpful" onclick="window.__fbClicks=(window.__fbClicks||0)+1">Helpful</button>
         <button type="button" class="devsite-thumb devsite-thumb-down" aria-label="Not helpful" onclick="window.__fbClicks=(window.__fbClicks||0)+1">Not helpful</button>
       </div></div>
     </devsite-thumb-rating>
     <h2>Real tabs still work</h2>
     ${tabWidget('real', [
       { label: 'Linux', panelId: 'os-linux', code: `${HEAD}REAL_LINUX_MIDDLE\n${TAIL}` },
       { label: 'Windows', panelId: 'os-win', code: `${HEAD}REAL_WINDOWS_MIDDLE\n${TAIL}` },
     ])}
     <h2>Docs page about a feedback product — semantic tabs must survive</h2>
     <div class="feedback-tool-docs">
       ${tabWidget('fbdocs', [
         { label: 'Python SDK', panelId: 'fb-py', code: `${HEAD}FEEDBACK_DOCS_PY_MIDDLE\n${TAIL}` },
         { label: 'REST', panelId: 'fb-rest', code: `${HEAD}FEEDBACK_DOCS_REST_MIDDLE\n${TAIL}` },
       ])}
     </div>`,
  ),
  '/oversize': page(
    'Oversize Panel',
    `<h2>Huge reference</h2>
     <div class="widget">
       <div role="tablist">
         <button role="tab" aria-controls="huge-a" aria-selected="true">Reference</button>
         <button role="tab" aria-controls="huge-b" aria-selected="false">Notes</button>
       </div>
       <section role="tabpanel" id="huge-a">${Array.from(
         { length: 180 },
         (_, i) => `<p>Oversize reference paragraph ${i} — ${'filler text '.repeat(12)}</p>`,
       ).join('')}<p>OVERSIZE_TAIL_MARKER</p></section>
       <section role="tabpanel" id="huge-b" hidden><p>NOTES_PANEL_PAYLOAD</p></section>
     </div>`,
  ),
  // Issue #12: ordinary buttons in <main> are NOT tab widgets. The T96 audit
  // reproduced this on http://127.0.0.1:PORT/actions — same shape below.
  '/actions-in-main': page(
    'Ordinary action buttons — not tabs',
    `${'<p>A public article with useful text for export. No action on this page should be invoked merely to read its content.</p>\n'.repeat(4)}
     <h2>Action buttons</h2>
     <div>
       <button type="button" id="like" onclick="window.__aClicks=(window.__aClicks||{});window.__aClicks.like=(window.__aClicks.like||0)+1">Like</button>
       <button type="button" id="bookmark" onclick="window.__aClicks=(window.__aClicks||{});window.__aClicks.bookmark=(window.__aClicks.bookmark||0)+1">Bookmark</button>
     </div>
     <div>
       <button type="button" id="deleteVi" onclick="window.__aClicks=(window.__aClicks||{});window.__aClicks.deleteVi=(window.__aClicks.deleteVi||0)+1">Xóa</button>
       <button type="button" id="subscribeVi" onclick="window.__aClicks=(window.__aClicks||{});window.__aClicks.subscribeVi=(window.__aClicks.subscribeVi||0)+1">Đăng ký</button>
     </div>
     <h2>Real ARIA tabs on the same page</h2>
     ${tabWidget('real', [
       { label: 'Python', panelId: 'main-py', code: `${HEAD}MAIN_PY_MIDDLE\n${TAIL}` },
       { label: 'JavaScript', panelId: 'main-js', code: `${HEAD}MAIN_JS_MIDDLE\n${TAIL}` },
     ])}`,
  ),
  // Issue #12 fallback path: an ancient jQuery UI shape with no ARIA but with
  // class="nav-tabs" on the container. The tightened discovery must still
  // discover this group via hasTabLikeAncestor.
  '/legacy-tabs': page(
    'Legacy tab strip with class="nav-tabs" and no ARIA',
    `<h2>Ancient jQuery UI shape</h2>
     <div class="nav-tabs">
       <button type="button" onclick="switchLegacy('one')">Legacy Home</button>
       <button type="button" onclick="switchLegacy('two')">Legacy Away</button>
     </div>
     <div id="legacy-one"><p>LEGACY_HOME_MIDDLE contents of first legacy pane.</p></div>
     <div id="legacy-two" hidden><p>LEGACY_AWAY_MIDDLE contents of second legacy pane.</p></div>
     <script>
       function switchLegacy(which) {
         document.getElementById('legacy-one').hidden = which !== 'one';
         document.getElementById('legacy-two').hidden = which !== 'two';
       }
     </script>`,
  ),
};

// --- plumbing (same shape as e2e-title-dedupe.mjs) --------------------------

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
  console.error(`FATAL: build output missing at ${EXT_PATH} — run npx wxt build --mode e2e first`);
  process.exit(2);
}

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const html = FIXTURES[u.pathname];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.statusCode = html ? 200 : 404;
  res.end(html || 'not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`fixture server: http://127.0.0.1:${port}`);

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    pipe: process.platform === 'win32',
    enableExtensions: [EXT_PATH],
    args: ['--no-first-run', '--disable-features=ChromeWhatsNewUI', '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

let browser;
try {
  browser = await launch(true);
} catch (e) {
  console.warn(`headless launch failed (${e.message}); retrying headful`);
  browser = await launch(false);
}

async function extract(browserPage, sw, url, options = {}) {
  await browserPage.goto(url, { waitUntil: 'load' });
  const tabId = await sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '') === u)?.id ?? null;
  }, url);
  if (tabId == null) throw new Error(`tab not found for ${url}`);
  await sw.evaluate(async (tabId, opts) => {
    globalThis.__e2eInjectError = null;
    await chrome.storage.session.remove(`result:${tabId}`);
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
  }, tabId, options);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const injectError = await sw.evaluate(() => globalThis.__e2eInjectError ?? null);
    if (injectError) throw new Error(`injection failed: ${injectError}`);
    const cached = await sw.evaluate(
      async (key) => (await chrome.storage.session.get(key))[key] ?? null,
      `result:${tabId}`,
    );
    if (cached) return cached.result;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no result within 90s for ${url}`);
}

const count = (md, needle) => md.split(needle).length - 1;

try {
  const tab = await browser.newPage();
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 20000 },
  );
  const sw = await swTarget.worker();
  check('service worker target found', Boolean(sw), swTarget.url());

  const base = `http://127.0.0.1:${port}`;

  // 1. Duplicate panel ids + shared code head/tail: every unique middle
  //    must be present exactly once (pre-fix: G2_* vanished entirely).
  {
    const r = await extract(tab, sw, `${base}/dup-ids`);
    const md = r.markdown || '';
    for (const m of ['G1_PYTHON_UNIQUE_MIDDLE', 'G1_JS_UNIQUE_MIDDLE', 'G2_PYTHON_UNIQUE_MIDDLE', 'G2_JS_UNIQUE_MIDDLE']) {
      const n = count(md, m);
      check(`dup-ids: ${m} present exactly once`, n === 1, `count=${n}`);
    }
    check('dup-ids: status ok', r.status === 'ok', `status=${r.status}`);
  }

  // 2. True duplicates: payload once, second location skipped WITH the
  //    duplicate marker (never a silent drop).
  {
    const r = await extract(tab, sw, `${base}/true-dup`);
    const md = r.markdown || '';
    const payload = count(md, 'TRUE_DUP_PAYLOAD');
    check('true-dup: payload appears exactly once', payload === 1, `count=${payload}`);
    check('true-dup: both distinct middles survive', count(md, 'OTHER_PAYLOAD_ONE') === 1 && count(md, 'OTHER_PAYLOAD_TWO') === 1);
    check(
      'true-dup: duplicate location carries the explanatory marker',
      md.includes('<!-- AI: TAB PANEL DUPLICATE OF A PANEL EXPORTED ABOVE (skipped) -->'),
    );
  }

  // 3. Toolbar chrome: not tabs, and NEVER clicked.
  {
    const r = await extract(tab, sw, `${base}/toolbar`);
    const md = r.markdown || '';
    check('toolbar: code payload survives', count(md, 'TOOLBAR_CODE_PAYLOAD') >= 1);
    check(
      'toolbar: toolbar/feedback buttons not grouped as tabs',
      !/\[Tab Button: (Dark code theme|Copy code sample|Helpful|Not helpful)\]/.test(md),
    );
    const clicks = await tab.evaluate(() => ({
      theme: window.__themeClicks || 0,
      copy: window.__copyClicks || 0,
      fb: window.__fbClicks || 0,
    }));
    check(
      'toolbar: no chrome button was clicked during extraction',
      clicks.theme === 0 && clicks.copy === 0 && clicks.fb === 0,
      JSON.stringify(clicks),
    );
    check('toolbar: real tab widget still captured (both middles)', count(md, 'REAL_LINUX_MIDDLE') === 1 && count(md, 'REAL_WINDOWS_MIDDLE') === 1);
    check(
      'toolbar: semantic tabs inside a *feedback* container still captured',
      count(md, 'FEEDBACK_DOCS_PY_MIDDLE') === 1 && count(md, 'FEEDBACK_DOCS_REST_MIDDLE') === 1,
    );
  }

  // 4. Oversize panel: left in place in full — the tail must survive and the
  //    panel must not be relocated under its button.
  {
    const r = await extract(tab, sw, `${base}/oversize`);
    const md = r.markdown || '';
    check('oversize: tail of the huge panel survives', count(md, 'OVERSIZE_TAIL_MARKER') === 1);
    check('oversize: huge panel not exported under the button', !/TAB PANEL START: Reference/.test(md));
    check('oversize: sibling normal panel still captured', count(md, 'NOTES_PANEL_PAYLOAD') === 1);
  }

  // 5. Issue #12: ordinary buttons in <main> are not tab widgets. Reproduces
  //    the T96 audit fixture where Like/Bookmark/Xóa/Đăng ký were classified
  //    as tabs and clicked during extraction.
  {
    const r = await extract(tab, sw, `${base}/actions-in-main`);
    const md = r.markdown || '';
    check('actions-in-main: status ok', r.status === 'ok', `status=${r.status}`);
    check(
      'actions-in-main: no [Tab Button: …] marker for any action label',
      !/\[Tab Button: (Like|Bookmark|Xóa|Đăng ký)\]/.test(md),
    );
    check(
      'actions-in-main: no TAB PANEL START marker for any action label',
      !/TAB PANEL START: (Like|Bookmark|Xóa|Đăng ký)/.test(md),
    );
    const clicks = await tab.evaluate(() => window.__aClicks || {});
    check(
      'actions-in-main: no ordinary button was clicked during extraction',
      !clicks.like && !clicks.bookmark && !clicks.deleteVi && !clicks.subscribeVi,
      JSON.stringify(clicks),
    );
    check(
      'actions-in-main: real ARIA tabs on the same page still captured',
      count(md, 'MAIN_PY_MIDDLE') === 1 && count(md, 'MAIN_JS_MIDDLE') === 1,
    );
  }

  // 6. Issue #12 fallback path: an ancient tab strip declared only through the
  //    container's class="nav-tabs". The safety fix must still discover it.
  {
    const r = await extract(tab, sw, `${base}/legacy-tabs`);
    const md = r.markdown || '';
    check('legacy-tabs: status ok', r.status === 'ok', `status=${r.status}`);
    check(
      'legacy-tabs: both legacy pane payloads survive',
      count(md, 'LEGACY_HOME_MIDDLE') === 1 && count(md, 'LEGACY_AWAY_MIDDLE') === 1,
    );
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
