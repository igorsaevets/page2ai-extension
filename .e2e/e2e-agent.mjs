// Page2AI e2e suite for the agent script (BL-45 option C): the extension's extractor, bundled by
// scripts/build-agent.mjs, run in the page's MAIN world the way Chrome DevTools MCP (evaluate_script) and
// Playwright MCP (--init-script) run it. Every route is extracted twice, by the extension (isolated world, the
// popup's code path) and by the agent script, and the two Markdown outputs must be equal.
//
//  /plain   — headings, ARIA tabs, a table, <details>, a list: the parity baseline.
//  /tt      — Trusted Types enforced (require-trusted-types-for 'script'): no sink in the bundle, so it works.
//  /csp     — a strict CSP (nonce scripts only, connect-src 'none', report-uri): CDP evaluation is exempt from
//             script-src.
//  On /plain, /tt and /csp the server also offers what a lookup would find (/llms.txt, /llms-full.txt,
//  /docs/llms.txt and a .md twin of every route), and neither world may request anything but the page itself:
//  the content comes only from the page (T135, BL-49). No CSP report may reach the server either.
//  /tamper  — page scripts wrap fetch and console and plant a fake window.__page2aiAgent before the agent runs:
//             the agent never writes to the console, the define script refuses to overwrite, and the function
//             form is not fooled.
//  /init    — the define script as an init script (Page.addScriptToEvaluateOnNewDocument, what --init-script
//             uses): the page's own script cannot replace window.__page2aiAgent afterwards.
//  /state   — research profile on a page with __NEXT_DATA__ in the DOM and __INITIAL_STATE__ / __NUXT__ as JS
//             globals: both worlds report only the DOM state, and the page's __NUXT__ function is never called.
//
// Run:  npm i --no-save puppeteer-core
//       npx wxt build --mode e2e && npm run build:agent
//       node .e2e/e2e-agent.mjs

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const EXT_PATH = path.resolve('.output/chrome-mv3-e2e');
const AGENT_DIR = path.resolve('.output/agent');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

const NONCE = 'e2eAgentNonce';
const RECORDER = `<script nonce="${NONCE}">
window.__violations = [];
document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI));
</script>`;
const TABS_SCRIPT = `<script nonce="${NONCE}">
for (const t of document.querySelectorAll('[role=tab]')) t.addEventListener('click', () => {
  for (const o of t.closest('[role=tablist]').querySelectorAll('[role=tab]')) {
    o.setAttribute('aria-selected', String(o === t));
    document.getElementById(o.getAttribute('aria-controls')).hidden = o !== t;
  }
});
</script>`;
const BODY = `<main>
<h1>Agent parity fixture</h1>
<p>PARITY_INTRO_MARKER with <a href="/docs/next">a link</a> and <code>inline_code</code>.</p>
<h2>Install</h2>
<div class="tabs">
  <div role="tablist" aria-label="Package manager">
    <button role="tab" id="t-npm" aria-selected="true" aria-controls="p-npm">npm</button>
    <button role="tab" id="t-yarn" aria-selected="false" aria-controls="p-yarn">yarn</button>
  </div>
  <div role="tabpanel" id="p-npm" aria-labelledby="t-npm"><pre><code>npm install TAB_NPM_MARKER --save-dev
npx page2ai convert https://example.com/docs/getting-started --output getting-started.md</code></pre></div>
  <div role="tabpanel" id="p-yarn" aria-labelledby="t-yarn" hidden><pre><code>yarn add TAB_YARN_MARKER --dev
yarn page2ai convert https://example.com/docs/getting-started --output getting-started.md</code></pre></div>
</div>
<h2>Options</h2>
<table><thead><tr><th>Option</th><th>Default</th></tr></thead>
<tbody><tr><td>profile</td><td>TABLE_CELL_MARKER</td></tr><tr><td>output</td><td>clean</td></tr></tbody></table>
<details><summary>More</summary><p>DETAILS_MARKER text inside a closed disclosure.</p></details>
<ul><li>LIST_ONE_MARKER</li><li>LIST_TWO_MARKER</li></ul>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"TechArticle","headline":"Agent parity fixture","keywords":["JSONLD_KW_ONE","JSONLD_KW_TWO"]}</script>
</main>`;
const page = (title, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${RECORDER}${head}</head>` +
  `<body>${BODY}${TABS_SCRIPT}</body></html>`;

const TAMPER_HEAD = `<script nonce="${NONCE}">
window.__fetchSeen = [];
const realFetch = window.fetch;
window.fetch = function (input, init) { window.__fetchSeen.push(String(input && input.url || input)); return realFetch.call(this, input, init); };
window.__consoleCalls = 0;
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = () => { window.__consoleCalls++; };
Object.defineProperty(window, '__page2aiAgent', { value: Object.freeze({ version: 'page', extract: async () => ({ markdown: 'FAKE_FROM_PAGE', status: 'ok' }) }), configurable: false });
</script>`;
const INIT_HEAD = `<script nonce="${NONCE}">
window.__hijack = [];
try { window.__page2aiAgent = { extract: async () => ({ markdown: 'FAKE_FROM_PAGE' }) }; } catch (e) { window.__hijack.push('assign: ' + e.name); }
try { Object.defineProperty(window, '__page2aiAgent', { value: 1 }); } catch (e) { window.__hijack.push('define: ' + e.name); }
</script>`;
const STATE_HEAD = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"NEXT_DATA_MARKER":1}}}</script>
<script nonce="${NONCE}">
window.__INITIAL_STATE__ = { INITIAL_STATE_MARKER: 1, user: { email: 'state-probe@example.invalid' } };
window.__nuxtCalls = 0;
window.__NUXT__ = () => { window.__nuxtCalls++; return { NUXT_MARKER: 1 }; };
</script>`;

const ROUTES = {
  '/plain': { html: page('Agent parity fixture') },
  '/tt': {
    html: page('Agent parity fixture'),
    csp: "require-trusted-types-for 'script'; trusted-types 'none'",
  },
  '/csp': {
    html: page('Agent parity fixture'),
    csp: `default-src 'none'; script-src 'nonce-${NONCE}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; report-uri /csp-report`,
  },
  '/tamper': { html: page('Agent parity fixture', TAMPER_HEAD) },
  '/init': { html: page('Agent parity fixture', INIT_HEAD) },
  '/state': { html: page('Agent parity fixture', STATE_HEAD) },
};

// --- plumbing (same shape as e2e-tab-panels.mjs) ------------------------------

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const info = (name, detail) => console.log(`INFO  ${name} — ${detail}`);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('FATAL: Chrome executable not found in standard locations');
  process.exit(2);
}
for (const f of [path.join(EXT_PATH, 'manifest.json'), path.join(AGENT_DIR, 'page2ai-agent.js')]) {
  if (!existsSync(f)) {
    console.error(`FATAL: ${f} missing — run npx wxt build --mode e2e && npm run build:agent first`);
    process.exit(2);
  }
}
const AGENT_FN = readFileSync(path.join(AGENT_DIR, 'page2ai-agent.fn.js'), 'utf8');
const AGENT_DEFINE = readFileSync(path.join(AGENT_DIR, 'page2ai-agent.js'), 'utf8');

// Every request that is not a navigation to a route (nor the browser's own favicon request) is an extra request.
const hits = { reports: 0, extra: [], all: [] };
const TWIN_MARKER = 'TWIN_ONLY_MARKER_NOT_ON_THE_PAGE';
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/csp-report') {
    hits.reports++;
    req.resume();
    res.statusCode = 204;
    return res.end();
  }
  if (u.pathname !== '/favicon.ico' && !ROUTES[u.pathname]) {
    hits.extra.push(u.pathname);
    hits.all.push(u.pathname);
  }
  if (/^\/(?:docs\/)?llms(?:-full)?\.txt$/.test(u.pathname) || u.pathname.endsWith('.md')) {
    // What a lookup would find: an index naming the twin, and a twin long enough to pass any size check.
    const page = u.pathname.replace(/\.md$/, '');
    res.setHeader('content-type', u.pathname.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
    return res.end(u.pathname.endsWith('.md')
      ? `# Twin\n\n${TWIN_MARKER}\n\n${'Twin paragraph text. '.repeat(40)}\n`
      : `# Fixture\n\n${Object.keys(ROUTES).map((r) => `- [${r}](http://${req.headers.host}${r}.md)`).join('\n')}\n`);
  }
  const route = ROUTES[u.pathname];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (route?.csp) res.setHeader('content-security-policy', route.csp);
  res.statusCode = route ? 200 : 404;
  res.end(route ? route.html : 'not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`fixture server: ${base}`);

const launch = (headless) =>
  puppeteer.launch({
    executablePath: chromePath,
    headless,
    pipe: process.platform === 'win32',
    enableExtensions: [EXT_PATH],
    args: ['--no-first-run', '--disable-features=ChromeWhatsNewUI', '--no-sandbox', '--disable-dev-shm-usage'],
  });
let browser;
try {
  browser = await launch(true);
} catch (e) {
  console.warn(`headless launch failed (${e.message}); retrying headful`);
  browser = await launch(false);
}

async function extractExtension(tab, sw, url, options = {}) {
  await tab.goto(url, { waitUntil: 'load' });
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? null, url);
  if (tabId == null) throw new Error(`tab not found for ${url}`);
  await sw.evaluate(async (tabId, opts) => {
    globalThis.__e2eInjectError = null;
    await chrome.storage.session.remove(`result:${tabId}`);
    await chrome.scripting.executeScript({ target: { tabId }, func: (k, o) => { globalThis[k] = o; }, args: ['__page2aiOptions', opts] });
    chrome.scripting.executeScript({ target: { tabId }, files: ['/extractor.js'] }).catch((e) => {
      globalThis.__e2eInjectError = String(e?.message || e);
    });
  }, tabId, options);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const err = await sw.evaluate(() => globalThis.__e2eInjectError ?? null);
    if (err) throw new Error(`injection failed: ${err}`);
    const cached = await sw.evaluate(async (k) => (await chrome.storage.session.get(k))[k] ?? null, `result:${tabId}`);
    if (cached) return cached.result;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no result within 90s for ${url}`);
}

async function extractAgent(tab, url, options = {}) {
  await tab.goto(url, { waitUntil: 'load' });
  const r = await tab.evaluate(`(${AGENT_FN})(${JSON.stringify(options)})`);
  if (!r || typeof r.page2ai !== 'string' || !Array.isArray(r.log)) throw new Error('agent script returned no Page2AI result');
  return r;
}

// The extension and the agent may differ only in the capture time.
const norm = (md) => md.replace(/^captured_at: ".*"$/m, 'captured_at: <time>');
const firstDiff = (a, b) => {
  const x = norm(a).split('\n');
  const y = norm(b).split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `line ${i + 1}: ext ${JSON.stringify((x[i] ?? '<none>').slice(0, 90))} / agent ${JSON.stringify((y[i] ?? '<none>').slice(0, 90))}`;
  }
  return '';
};
const MARKERS = ['PARITY_INTRO_MARKER', 'TAB_NPM_MARKER', 'TAB_YARN_MARKER', 'TABLE_CELL_MARKER', 'LIST_ONE_MARKER'];
const missing = (md) => MARKERS.filter((m) => !md.includes(m));
const counters = (tab) =>
  tab.evaluate(() => ({ violations: window.__violations?.length ?? -1, fetchSeen: window.__fetchSeen?.length ?? null, consoleCalls: window.__consoleCalls ?? null }));

try {
  const tab = await browser.newPage();
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 20000 });
  const sw = await swTarget.worker();
  check('service worker target found', Boolean(sw), swTarget.url());

  // 1. Parity on every route the extension can reach, plus what each world costs on the page.
  for (const route of ['/plain', '/tt', '/csp']) {
    hits.reports = 0;
    hits.extra = [];
    const ext = await extractExtension(tab, sw, base + route);
    await new Promise((r) => setTimeout(r, 300)); // let report-uri POSTs land
    const extC = await counters(tab);
    const extHits = { reports: hits.reports, extra: [...hits.extra] };
    hits.reports = 0;
    hits.extra = [];
    const agent = await extractAgent(tab, base + route);
    await new Promise((r) => setTimeout(r, 300)); // let report-uri POSTs land
    const agC = await counters(tab);
    check(`${route}: the extension requests nothing but the page`, extHits.extra.length === 0, extHits.extra.join(' '));
    check(`${route}: the agent requests nothing but the page`, hits.extra.length === 0, hits.extra.join(' '));
    check(`${route}: no CSP report from either world`, extHits.reports === 0 && hits.reports === 0, `extension ${extHits.reports}, agent ${hits.reports}`);
    check(`${route}: neither output holds the twin's text`, !ext.markdown.includes(TWIN_MARKER) && !agent.markdown.includes(TWIN_MARKER));
    check(`${route}: agent status ok`, agent.status === 'ok', `status=${agent.status}`);
    check(`${route}: agent output has every marker`, missing(agent.markdown).length === 0, missing(agent.markdown).join(', '));
    check(`${route}: agent Markdown equals the extension's`, norm(agent.markdown) === norm(ext.markdown), firstDiff(ext.markdown, agent.markdown));
    info(`${route}: CSP violations in the page`, `extension ${extC.violations}, agent ${agC.violations}`);
    if (route === '/tt') check('/tt: no Trusted Types violation from the agent', agC.violations === 0, `violations=${agC.violations}`);
  }

  // 2. A page that wraps fetch and console and plants a fake agent object.
  {
    const ext = await extractExtension(tab, sw, `${base}/tamper`);
    const extC = await counters(tab);
    const agent = await extractAgent(tab, `${base}/tamper`);
    const agC = await counters(tab);
    check('/tamper: the function form is not fooled by a planted window.__page2aiAgent', !agent.markdown.includes('FAKE_FROM_PAGE') && missing(agent.markdown).length === 0);
    check('/tamper: the agent never calls the console', agC.consoleCalls === 0, `calls=${agC.consoleCalls}`);
    check('/tamper: agent Markdown equals the extension\'s', norm(agent.markdown) === norm(ext.markdown), firstDiff(ext.markdown, agent.markdown));
    check('/tamper: the page\'s own fetch wrapper saw no call from either world', extC.fetchSeen === 0 && agC.fetchSeen === 0, `extension ${extC.fetchSeen}, agent ${agC.fetchSeen}`);
    await tab.goto(`${base}/tamper`, { waitUntil: 'load' });
    let refused = '';
    try {
      await tab.evaluate(AGENT_DEFINE);
    } catch (e) {
      refused = String(e.message || e);
    }
    check('/tamper: the define script refuses to overwrite a planted global', /already defined by something else/.test(refused), refused.slice(0, 120));
  }

  // 3. The define script as an init script: it runs before the page, and the page cannot replace it.
  {
    const p2 = await browser.newPage();
    await p2.evaluateOnNewDocument(AGENT_DEFINE);
    await p2.goto(`${base}/init`, { waitUntil: 'load' });
    const hijack = await p2.evaluate(() => window.__hijack);
    const r = await p2.evaluate(() => window.__page2aiAgent.extract());
    check('/init: the page could not redefine window.__page2aiAgent', hijack.includes('define: TypeError'), JSON.stringify(hijack));
    check('/init: extract() through the global returns the real page', r.status === 'ok' && missing(r.markdown).length === 0 && !r.markdown.includes('FAKE_FROM_PAGE'));
    check('/init: the global is not enumerable', await p2.evaluate(() => !Object.keys(window).includes('__page2aiAgent')));
    await p2.close();
  }

  // 4. Page state: only what the DOM carries, in both worlds; the page's __NUXT__ is never called.
  {
    const opts = { profile: 'research' };
    const ext = await extractExtension(tab, sw, `${base}/state`, opts);
    const agent = await extractAgent(tab, `${base}/state`, opts);
    const nuxtCalls = await tab.evaluate(() => window.__nuxtCalls);
    for (const [who, md] of [['extension', ext.markdown], ['agent', agent.markdown]]) {
      check(`/state: ${who} keeps __NEXT_DATA__ from the DOM`, md.includes('NEXT_DATA_MARKER'));
      check(`/state: ${who} has no JS-global state`, !md.includes('INITIAL_STATE_MARKER') && !md.includes('NUXT_MARKER') && !md.includes('state-probe@'));
    }
    check('/state: the agent never called the page\'s __NUXT__', nuxtCalls === 0, `calls=${nuxtCalls}`);
    check('/state: agent Markdown equals the extension\'s', norm(agent.markdown) === norm(ext.markdown), firstDiff(ext.markdown, agent.markdown));
  }

  // 5. Over the whole run, on every route and in both worlds: no request but the pages themselves.
  check('whole run: no request but the pages themselves', hits.all.length === 0, [...new Set(hits.all)].join(' '));
} catch (e) {
  check('suite ran to completion', false, String(e && e.stack ? e.stack : e).slice(0, 400));
} finally {
  await browser.close().catch(() => undefined);
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
