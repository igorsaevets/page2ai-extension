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
//  BL-19 round 2 (T118): toggle groups, toolbars, dialog footers in any
//  language, content buttons inside a panel, button groups, disclosures,
//  close/add buttons inside a tablist, buttons that own a form from outside it,
//  carousels, popover/command invokers: each counts its clicks and must count
//  zero. A strip that reveals nothing costs at most one click (first-click
//  guard). The aggressive profile closes a menu on its own trigger and never
//  sends Escape. W3Schools, Bootstrap 5 data-bs-toggle and Radix Tabs are the
//  positive controls.
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

// BL-19 round 2 fixtures count every click in the page: window.__aClicks[id].
const COUNTER = `<script>function c(k){(window.__aClicks=window.__aClicks||{})[k]=(window.__aClicks[k]||0)+1}</script>`;
const cb = (id, label, attrs = '') =>
  `<button type="button" id="${id}" ${attrs} onclick="c('${id}')">${label}</button>`;

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
  // --- BL-19 round 2 (T118). Every negative fixture below is a shape the old
  // classifier ACCEPTED (traced in DESIGN.md D1-D10); each counts its clicks in
  // the page, so a regression shows as a number, not as a missing marker.
  '/radix-toggle': page(
    'Radix ToggleGroup and Toolbar (D1)',
    `${COUNTER}<h2>Formatting</h2>
     <div role="group" dir="ltr" data-orientation="horizontal" class="tabs">
       ${cb('tgB', 'Bold', 'role="radio" aria-checked="true" data-state="on" data-orientation="horizontal" class="active"')}
       ${cb('tgI', 'Italic', 'role="radio" aria-checked="false" data-state="off" data-orientation="horizontal"')}
     </div>
     <div role="group" data-orientation="horizontal">
       ${cb('tmB', 'Strong', 'aria-pressed="true" data-state="on" data-orientation="horizontal"')}
       ${cb('tmU', 'Underline', 'aria-pressed="false" data-state="off" data-orientation="horizontal"')}
     </div>
     <div role="toolbar" data-orientation="horizontal" aria-label="Alignment">
       ${cb('tbL', 'Left', 'data-orientation="horizontal" class="active"')}
       ${cb('tbC', 'Center', 'data-orientation="horizontal"')}
     </div>`,
  ),
  '/dialog-footer': page(
    'Dialog footers outside EN (D3, D5)',
    `${COUNTER}<div class="modal show" style="display:block;position:static" role="dialog">
       <div class="modal-content"><div class="modal-body"><p>Nội dung hộp thoại.</p></div>
       <div class="modal-footer">${cb('vHuy', 'Hủy', 'class="btn btn-secondary"')}${cb('vLuu', 'Lưu', 'class="btn btn-primary"')}</div></div>
     </div>
     <div role="dialog"><p>Los cambios no se han guardado.</p>
       <footer class="tabs">${cb('esC', 'Cancelar', 'class="active"')}${cb('esG', 'Guardar')}</footer></div>
     <div class="el-dialog__footer">${cb('zhC', '取消')}${cb('zhS', '保存', 'class="btn-primary"')}</div>`,
  ),
  '/panel-content': page(
    'Content buttons inside a tab panel (D2)',
    `${COUNTER}<div class="widget">
       <div role="tablist">
         <button role="tab" aria-controls="pc-a" aria-selected="true">Overview</button>
         <button role="tab" aria-controls="pc-b" aria-selected="false">Details</button>
       </div>
       <div class="tab-content">
         <section class="tab-pane" role="tabpanel" id="pc-a"><p>PANEL_A_MIDDLE was this answer helpful?</p>
           <div>${cb('pcYes', 'Yes', 'class="active"')}${cb('pcNo', 'No')}</div></section>
         <section class="tab-pane" role="tabpanel" id="pc-b" hidden><p>PANEL_B_MIDDLE details of the second panel.</p></section>
       </div>
     </div>`,
  ),
  '/btn-group': page(
    'Bootstrap btn-group view switcher (D3)',
    `${COUNTER}<div class="tabs"><div class="btn-group" role="group">
       ${cb('bgD', 'Day', 'class="btn btn-outline active"')}${cb('bgW', 'Week', 'class="btn btn-outline"')}${cb('bgM', 'Month', 'class="btn btn-outline"')}
     </div></div>`,
  ),
  '/disclosure': page(
    'Disclosure buttons and carousel arrows (D3)',
    `${COUNTER}<div class="tab-bar">
       ${cb('dc1', 'Shipping', 'aria-expanded="false" aria-controls="dcp1"')}${cb('dc2', 'Returns', 'aria-expanded="false" aria-controls="dcp2"')}
     </div>
     <div id="dcp1" hidden>Shipping text</div><div id="dcp2" hidden>Returns text</div>
     <div class="carousel-controls">${cb('crPrev', 'Previous', 'aria-controls="car1"')}${cb('crNext', 'Next', 'aria-controls="car1" class="active"')}</div>
     <div id="car1"><p>Slide text</p></div>`,
  ),
  '/tablist-chrome': page(
    'Closable tab strip: close and add buttons inside the tablist (D7)',
    `${COUNTER}<div class="widget">
       <div role="tablist">
         <button role="tab" aria-controls="tc-a" aria-selected="true">main.py</button>
         ${cb('tcClose', '×', 'aria-label="Close main.py"')}
         <button role="tab" aria-controls="tc-b" aria-selected="false">util.py</button>
         ${cb('tcAdd', '+')}
       </div>
       <section role="tabpanel" id="tc-a"><pre><code>TC_MAIN_MIDDLE = 1</code></pre></section>
       <section role="tabpanel" id="tc-b" hidden><pre><code>TC_UTIL_MIDDLE = 2</code></pre></section>
     </div>`,
  ),
  '/form-owner': page(
    'Buttons that submit a form they are not inside (D8)',
    `${COUNTER}<form id="f1" action="/never" onsubmit="c('submit');return false"><input name="q" value="x"></form>
     <div class="tab-bar">
       <button id="foN" form="f1" onclick="c('foN')">Weiter</button>
       <button id="foB" form="f1" onclick="c('foB')">Zurück</button>
     </div>`,
  ),
  '/first-click': page(
    'A tab-looking strip whose buttons reveal nothing (D4, D9)',
    `${COUNTER}<div class="tab-bar">${cb('fcA', 'Alpha')}${cb('fcB', 'Beta')}${cb('fcG', 'Gamma')}</div>
     <p>Nothing on this page changes when those three buttons are pressed.</p>`,
  ),
  '/carousel': page(
    'Carousel slide pickers marked up as a tablist (APG pattern)',
    `${COUNTER}<section aria-roledescription="carousel" aria-label="Featured">
       <div role="tablist" aria-label="Slides">
         ${cb('cs1', '', 'role="tab" aria-label="Slide 1" aria-selected="true" aria-controls="sl1"')}
         ${cb('cs2', '', 'role="tab" aria-label="Slide 2" aria-selected="false" aria-controls="sl2"')}
       </div>
       <div id="sl1" role="tabpanel"><p>Slide one text</p></div><div id="sl2" role="tabpanel" hidden><p>Slide two text</p></div>
     </section>`,
  ),
  '/invokers': page(
    'Popover and command invoker buttons',
    `${COUNTER}<div class="tab-bar">
       <button id="ivP" popovertarget="pop1" onclick="c('ivP')">Info</button>
       <button id="ivC" commandfor="dlg1" command="show-modal" onclick="c('ivC')">More</button>
       <button id="ivD" onclick="c('ivD')" class="active">Plain</button>
     </div>
     <div id="pop1" popover>Popover text</div><dialog id="dlg1">Dialog text</dialog>`,
  ),
  '/escape': page(
    'Aggressive profile: a menu next to the reader own open dialog (D6, D10)',
    `${COUNTER}<div id="userModal" role="dialog"><p>USER_MODAL_TEXT the reader is still editing.</p></div>
     <script>
       window.__esc = 0;
       document.addEventListener('keydown', (e) => {
         if (e.key === 'Escape') { window.__esc++; document.getElementById('userModal').hidden = true; }
       }, true);
       function toggleMenu(btn) {
         c('menuBtn');
         const open = btn.getAttribute('aria-expanded') === 'true';
         btn.setAttribute('aria-expanded', String(!open));
         document.getElementById('menu1').hidden = open;
       }
     </script>
     <div>
       <button type="button" id="menuBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="menu1" onclick="toggleMenu(this)">Options</button>
       <div role="menu" id="menu1" hidden><div role="menuitem">MENU_ITEM_PAYLOAD</div></div>
       <button type="button" id="shareBtn" aria-haspopup="dialog" onclick="c('shareBtn')">Share</button>
     </div>`,
  ),
  // Positive controls: real widgets the stricter rules must still capture.
  '/w3schools': page(
    'W3Schools tabs: div.tab > button.tablinks',
    `<div class="tab">
       <button class="tablinks active" onclick="openCity(event, 'London')">London</button>
       <button class="tablinks" onclick="openCity(event, 'Paris')">Paris</button>
     </div>
     <div id="London" class="tabcontent" style="display:block"><p>W3_LONDON_MIDDLE is the capital city of England.</p></div>
     <div id="Paris" class="tabcontent" style="display:none"><p>W3_PARIS_MIDDLE is the capital of France.</p></div>
     <script>
       function openCity(evt, name) {
         document.querySelectorAll('.tabcontent').forEach((t) => { t.style.display = 'none'; });
         document.querySelectorAll('.tablinks').forEach((t) => { t.className = t.className.replace(' active', ''); });
         document.getElementById(name).style.display = 'block';
         evt.currentTarget.className += ' active';
       }
     </script>`,
  ),
  '/bootstrap5': page(
    'Bootstrap 5 tabs declared by data-bs-toggle, no role=tablist',
    `<div class="nav nav-tabs" id="bsTabs">
       <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#bs-home" type="button">Home</button>
       <button class="nav-link" data-bs-toggle="tab" data-bs-target="#bs-profile" type="button">Profile</button>
     </div>
     <div class="tab-content">
       <div class="tab-pane active" id="bs-home"><p>BS_HOME_MIDDLE first pane.</p></div>
       <div class="tab-pane" id="bs-profile" style="display:none"><p>BS_PROFILE_MIDDLE second pane.</p></div>
     </div>
     <script>
       document.querySelectorAll('#bsTabs [data-bs-toggle="tab"]').forEach((b) => b.addEventListener('click', () => {
         document.querySelectorAll('#bsTabs .nav-link').forEach((x) => x.classList.toggle('active', x === b));
         document.querySelectorAll('.tab-pane').forEach((p) => {
           const on = '#' + p.id === b.getAttribute('data-bs-target');
           p.classList.toggle('active', on);
           p.style.display = on ? 'block' : 'none';
         });
       }));
     </script>`,
  ),
  '/radix-tabs': page(
    'Radix Tabs: data-state active/inactive, inactive panel unmounted',
    `<div dir="ltr" data-orientation="horizontal" class="rx">
       <div role="tablist" aria-orientation="horizontal" data-orientation="horizontal">
         <button type="button" role="tab" aria-selected="true" aria-controls="rx-c-a" data-state="active" data-orientation="horizontal">Account</button>
         <button type="button" role="tab" aria-selected="false" aria-controls="rx-c-p" data-state="inactive" data-orientation="horizontal">Password</button>
       </div>
       <div data-state="active" role="tabpanel" id="rx-c-a"><p>RX_ACCOUNT_MIDDLE account settings.</p></div>
       <div data-state="inactive" role="tabpanel" id="rx-c-p" hidden></div>
     </div>
     <script>
       const RX = { 'rx-c-a': 'RX_ACCOUNT_MIDDLE account settings.', 'rx-c-p': 'RX_PASSWORD_MIDDLE password settings.' };
       document.querySelectorAll('.rx [role="tab"]').forEach((t) => t.addEventListener('click', () => {
         document.querySelectorAll('.rx [role="tab"]').forEach((x) => {
           const on = x === t;
           x.setAttribute('aria-selected', String(on));
           x.dataset.state = on ? 'active' : 'inactive';
         });
         document.querySelectorAll('.rx [role="tabpanel"]').forEach((p) => {
           const on = p.id === t.getAttribute('aria-controls');
           p.dataset.state = on ? 'active' : 'inactive';
           p.hidden = !on;
           p.innerHTML = on ? '<p>' + RX[p.id] + '</p>' : '';
         });
       }));
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
  // 7. BL-19 round 2 negatives: zero clicks, and no [Tab Button: …] marker.
  const NEGATIVES = [
    ['/radix-toggle', ['tgB', 'tgI', 'tmB', 'tmU', 'tbL', 'tbC'], /\[Tab Button: (Bold|Italic|Strong|Underline|Left|Center)\]/],
    ['/dialog-footer', ['vHuy', 'vLuu', 'esC', 'esG', 'zhC', 'zhS'], /\[Tab Button: (Hủy|Lưu|Cancelar|Guardar|取消|保存)\]/],
    ['/panel-content', ['pcYes', 'pcNo'], /\[Tab Button: (Yes|No)\]/],
    ['/btn-group', ['bgD', 'bgW', 'bgM'], /\[Tab Button: (Day|Week|Month)\]/],
    ['/disclosure', ['dc1', 'dc2', 'crPrev', 'crNext'], /\[Tab Button: (Shipping|Returns|Previous|Next)\]/],
    ['/tablist-chrome', ['tcClose', 'tcAdd'], /\[Tab Button: (×|\+)\]/],
    ['/form-owner', ['foN', 'foB', 'submit'], /\[Tab Button: (Weiter|Zurück)\]/],
    ['/carousel', ['cs1', 'cs2'], /\[Tab Button: Slide/],
    ['/invokers', ['ivP', 'ivC', 'ivD'], /\[Tab Button: (Info|More|Plain)\]/],
  ];
  for (const [route, ids, marker] of NEGATIVES) {
    const r = await extract(tab, sw, `${base}${route}`);
    const md = r.markdown || '';
    const clicks = await tab.evaluate(() => window.__aClicks || {});
    const hit = ids.filter((k) => clicks[k]);
    check(`${route}: status ok`, r.status === 'ok', `status=${r.status}`);
    check(`${route}: none of ${ids.length} controls clicked`, hit.length === 0, JSON.stringify(clicks));
    check(`${route}: no [Tab Button: …] marker`, !marker.test(md));
  }
  {
    const r = await extract(tab, sw, `${base}/panel-content`);
    const md = r.markdown || '';
    check('panel-content: the real tabs around the content buttons still captured',
      count(md, 'PANEL_A_MIDDLE') >= 1 && count(md, 'PANEL_B_MIDDLE') >= 1);
  }
  {
    const r = await extract(tab, sw, `${base}/tablist-chrome`);
    const md = r.markdown || '';
    check('tablist-chrome: both editor tabs captured', count(md, 'TC_MAIN_MIDDLE') >= 1 && count(md, 'TC_UTIL_MIDDLE') >= 1);
  }

  // 8. First-click guard: a strip that passes the classifier but reveals
  //    nothing costs at most one click, and nothing "restores" it.
  {
    await extract(tab, sw, `${base}/first-click`);
    const clicks = await tab.evaluate(() => window.__aClicks || {});
    const total = (clicks.fcA || 0) + (clicks.fcB || 0) + (clicks.fcG || 0);
    check('first-click: at most one click on a strip that reveals no panel', total <= 1, JSON.stringify(clicks));
  }

  // 9. Aggressive profile: the menu is opened and closed on its own trigger;
  //    no Escape reaches the reader's dialog; a dialog opener is never clicked.
  {
    const r = await extract(tab, sw, `${base}/escape`, { overrides: { interactionMode: 'aggressive' } });
    const md = r.markdown || '';
    const s = await tab.evaluate(() => ({
      clicks: window.__aClicks || {},
      esc: window.__esc,
      modalHidden: document.getElementById('userModal').hidden,
      expanded: document.getElementById('menuBtn').getAttribute('aria-expanded'),
    }));
    check('escape: the menu was opened (aggressive profile active)', (s.clicks.menuBtn || 0) >= 1, JSON.stringify(s));
    check('escape: menu content captured', count(md, 'MENU_ITEM_PAYLOAD') >= 1);
    check('escape: no Escape keydown reached the document', s.esc === 0, JSON.stringify(s));
    check("escape: the reader's dialog is still open", s.modalHidden === false);
    check('escape: the menu was closed on its trigger', s.expanded === 'false' && s.clicks.menuBtn === 2, JSON.stringify(s));
    check('escape: aria-haspopup="dialog" opener never clicked', !s.clicks.shareBtn, JSON.stringify(s));
  }

  // 10. Positive controls for the stricter rules.
  for (const [route, needles] of [
    ['/w3schools', ['W3_LONDON_MIDDLE', 'W3_PARIS_MIDDLE']],
    ['/bootstrap5', ['BS_HOME_MIDDLE', 'BS_PROFILE_MIDDLE']],
    ['/radix-tabs', ['RX_ACCOUNT_MIDDLE', 'RX_PASSWORD_MIDDLE']],
  ]) {
    const r = await extract(tab, sw, `${base}${route}`);
    const md = r.markdown || '';
    check(`${route}: every panel captured`, needles.every((n) => count(md, n) >= 1),
      needles.map((n) => `${n}=${count(md, n)}`).join(' '));
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
