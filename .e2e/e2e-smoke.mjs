// Page2AI e2e smoke test: loads the built extension into real Chrome,
// injects the extractor into a local test page using the exact two-step
// executeScript sequence the background uses, then asserts on the result the
// background cached in storage.session.
//
// Run:  npm i --no-save puppeteer-core
//       npx wxt build --mode e2e   (grants http://127.0.0.1/* so no gesture is needed)
//       node .e2e/e2e-smoke.mjs
//
// Requires Chrome 126+ (puppeteer enableExtensions uses CDP Extensions.loadUnpacked;
// the old --load-extension flag was removed from branded stable Chrome).

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

// WXT appends the non-production mode name to the output dir.
const EXT_PATH = path.resolve('.output/chrome-mv3-e2e');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];

const TEST_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Page2AI Test Fixture — Getting Started</title>
<meta name="description" content="Fixture page for the Page2AI e2e smoke test.">
<meta name="author" content="Igor Saevets">
<meta name="keywords" content="markdown, chrome-extension, RAG">
<meta property="og:title" content="Page2AI Test Fixture — OG Title Override">
<meta property="og:description" content="OG description differs from meta name=description.">
<meta property="og:image" content="https://example.com/og.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Page2AI Docs">
<meta property="og:locale" content="en_US">
<meta property="article:published_time" content="2026-01-15T09:00:00Z">
<meta property="article:modified_time" content="2026-06-30T12:00:00Z">
<meta property="article:author" content="Igor Saevets">
<meta property="article:section" content="Documentation">
<meta property="article:tag" content="page2ai">
<meta property="article:tag" content="markdown">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://example.com/twitter.png">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"Getting Started","author":{"@type":"Person","name":"Jane Doe"},"datePublished":"2026-01-15T09:00:00Z"}
</script>
</head>
<body>
<main>
  <h1>Getting Started</h1>
  <p>Install <strong>Page2AI</strong> and convert <em>any</em> page. Read the
  <a href="https://example.com/docs">full documentation</a> for details.</p>

  <h2>Install</h2>
  <div role="tablist" aria-label="Package manager">
    <button role="tab" id="tab-npm" aria-selected="true" aria-controls="panel-npm">npm</button>
    <button role="tab" id="tab-pnpm" aria-selected="false" aria-controls="panel-pnpm">pnpm</button>
  </div>
  <div role="tabpanel" id="panel-npm" aria-labelledby="tab-npm">Run npm install page2ai to get started.</div>
  <div role="tabpanel" id="panel-pnpm" aria-labelledby="tab-pnpm" hidden>Run pnpm add page2ai PNPM-SECRET-MARKER.</div>

  <h2>Example</h2>
  <pre><code>const md = await extract(document);
console.log(md.length);</code></pre>

  <h2>Options</h2>
  <table>
    <thead><tr><th>Option</th><th>Default</th></tr></thead>
    <tbody>
      <tr><td>profile</td><td>auto</td></tr>
      <tr><td>lazyLoadMode</td><td>safe</td></tr>
    </tbody>
  </table>

  <details>
    <summary>Advanced notes</summary>
    <p>DETAILS-HIDDEN-CONTENT lives behind a closed details element.</p>
  </details>

  <blockquote>Markdown is the lingua franca of LLMs.</blockquote>
  <ul><li>First point</li><li>Second point<ul><li>Nested point</li></ul></li></ul>
</main>
<footer><a href="/docs/about">About</a></footer>
<script>
  const tabs = [['tab-npm','panel-npm'],['tab-pnpm','panel-pnpm']];
  for (const [tabId, panelId] of tabs) {
    document.getElementById(tabId).addEventListener('click', () => {
      for (const [t, p] of tabs) {
        document.getElementById(t).setAttribute('aria-selected', String(t === tabId));
        document.getElementById(p).hidden = p !== panelId;
      }
    });
  }
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
const pageUrl = `http://127.0.0.1:${port}/docs/getting-started`;
console.log(`test page: ${pageUrl}`);
console.log(`chrome:    ${chromePath}`);

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

try {
  const page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: 'load' });

  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 20000 },
  );
  const sw = await swTarget.worker();
  check('service worker target found', Boolean(sw), swTarget.url());

  const tabId = await sw.evaluate(async (prefix) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url || '').startsWith(prefix))?.id ?? null;
  }, `http://127.0.0.1:${port}/`);
  check('test tab visible from SW', tabId != null, `tabId=${tabId}`);
  if (tabId == null) throw new Error('no tab');

  // Same two-step injection the background performs.
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
  console.log('extractor injected, waiting for cached result…');

  let cached = null;
  const deadline = Date.now() + 90000;
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
  check('result cached in storage.session', Boolean(cached));
  if (!cached) throw new Error('no result within 90s');

  const { result } = cached;
  const md = result.markdown || '';
  check('status ok', result.status === 'ok', `status=${result.status}`);
  check('profile detected as docs (/docs/ path)', result.profile === 'docs', `profile=${result.profile}`);
  check('cached url matches', cached.url === pageUrl, cached.url);
  check('frontmatter has source', md.includes(`source: "${pageUrl}"`));
  check('frontmatter has og_title (differs from plain title)', md.includes('og_title: "Page2AI Test Fixture — OG Title Override"'));
  check('frontmatter has og_description', md.includes('og_description: "OG description differs from meta name=description."'));
  check('frontmatter has og_image', md.includes('og_image: "https://example.com/og.png"'));
  check('frontmatter has og_type', md.includes('og_type: "article"'));
  check('frontmatter has og_site_name', md.includes('og_site_name: "Page2AI Docs"'));
  check('frontmatter has og_locale', md.includes('og_locale: "en_US"'));
  check('frontmatter has twitter_card', md.includes('twitter_card: "summary_large_image"'));
  check('frontmatter has twitter_image (differs from og_image)', md.includes('twitter_image: "https://example.com/twitter.png"'));
  check('frontmatter has published date', md.includes('published: "2026-01-15T09:00:00Z"'));
  check('frontmatter has modified date', md.includes('modified: "2026-06-30T12:00:00Z"'));
  check('frontmatter has author (article:author preferred)', md.includes('author: "Igor Saevets"'));
  check('frontmatter has section', md.includes('section: "Documentation"'));
  check('frontmatter has keywords', md.includes('keywords: "markdown, chrome-extension, RAG"'));
  check('frontmatter has tags as YAML flow-sequence', md.includes('tags: ["page2ai", "markdown"]'));
  check('h1 rendered', md.includes('# Getting Started'));
  check('code fence rendered', md.includes('```'));
  check('table rendered', /\|\s*Option\s*\|/.test(md));
  check('link rendered', md.includes('](https://example.com/docs)'));
  check('hidden tab panel captured via click', md.includes('PNPM-SECRET-MARKER'));
  check('closed details content captured', md.includes('DETAILS-HIDDEN-CONTENT'));
  check('nested list rendered', md.includes('- Nested point'));
  check('blockquote rendered', md.includes('> Markdown is the lingua franca'));
  check('quality report present', Boolean(result.quality?.ratioStatus), result.quality?.ratioStatus);
  check('tabs captured count > 0', (result.tabsCaptured ?? 0) > 0, `tabsCaptured=${result.tabsCaptured}`);

  console.log('\n--- markdown head (first 60 lines) ---');
  console.log(md.split('\n').slice(0, 60).join('\n'));
  console.log('--- end ---\n');
  console.log(`markdown length: ${md.length} chars; filename: ${result.filename}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
