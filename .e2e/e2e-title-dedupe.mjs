// Page2AI e2e suite for issue #8: the synthetic title heading must not
// duplicate the page's own first heading (port of page2ai-core#9).
//
// Every assertion states the FIXED behavior. Against an unfixed build the
// dup/later-dup/escaped/official cases fail — that failing run is the
// in-browser reproduction the issue asks for; keep its output.
//
// Run:  npm i --no-save puppeteer-core
//       npx wxt build --mode e2e   (grants http://127.0.0.1/* so no gesture is needed)
//       node .e2e/e2e-title-dedupe.mjs
//
// Live-web half (the URLs named in #8) needs broad host access:
//       npx wxt build --mode real-test
//       E2E_LIVE=1 node .e2e/e2e-title-dedupe.mjs

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const LIVE = process.env.E2E_LIVE === '1';
// WXT appends the non-production mode name to the output dir.
const EXT_PATH = path.resolve(LIVE ? '.output/chrome-mv3-real-test' : '.output/chrome-mv3-e2e');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

const page = (title, body) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<meta name="description" content="Fixture for the title-dedupe e2e suite."></head>
<body><main>${body}</main></body></html>`;

// The h1 textContent carries whitespace noise on purpose: the comparison must
// squeeze (cleanInline), not string-compare raw text.
const FIXTURES = {
  '/dup': page(
    'Example Fixture Domain',
    `<h1>Example   Fixture\n      Domain</h1>
     <p>This fixture mirrors example.com: the page h1 equals document.title.</p>
     <h2>Section</h2>
     <p>Enough body text that the render is not empty.</p>`,
  ),
  '/distinct': page(
    'Fixture Manual — Page2AI Docs',
    `<h1>Fixture Manual</h1>
     <p>Title carries a site suffix, the h1 does not: nothing may be removed.</p>`,
  ),
  '/later-dup': page(
    'Release Notes',
    `<h1>Release Notes</h1>
     <p>The window closes at the first heading.</p>
     <h2>Release Notes</h2>
     <p>An identical heading later in the page is content and must survive.</p>`,
  ),
  '/escaped': page(
    'Dup *Title* [beta]',
    `<h1>Dup *Title* [beta]</h1>
     <p>The rendered heading escapes markdown specials, the synthetic one does
     not — the comparison must run on textContent or it never matches.</p>`,
  ),
  '/official-dup': page(
    'Official Dup Fixture',
    `<p>Short shell body; the official markdown mirror below replaces it.</p>`,
  ),
  // Empty title: the window must stay inert. This is the one case whose
  // failure mode is over-removal, so it gets its own fixture: the h1 happens
  // to equal the 'Untitled page' fallback the synthetic heading uses, and
  // BOTH must render.
  '/empty-title': page(
    '',
    `<h1>Untitled page</h1>
     <p>No document.title; nothing may be deduped against the fallback.</p>`,
  ),
};

const OFFICIAL_MD = [
  '# Official Dup Fixture',
  '',
  'The official mirror opens with the same H1 the synthetic title line provides.',
  '',
  'Paragraph two pads the mirror well past the ratio gate so the short path',
  'actually engages instead of falling through to the DOM walk.',
  '',
  'Paragraph three, more padding text for the ratio gate to clear easily.',
].join('\n');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- markdown helpers -------------------------------------------------------

const stripFrontmatter = (md) => {
  const lines = md.split('\n');
  if (lines[0] !== '---') return md;
  const end = lines.indexOf('---', 1);
  return end === -1 ? md : lines.slice(end + 1).join('\n');
};

const countExactLine = (md, line) =>
  stripFrontmatter(md)
    .split('\n')
    .filter((l) => l.trim() === line)
    .length;

const headOf = (md, n = 14) =>
  stripFrontmatter(md).split('\n').filter((l) => l.trim()).slice(0, n).join('\n');

// --- browser plumbing (same shape as e2e-smoke.mjs) -------------------------

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('FATAL: Chrome executable not found in standard locations');
  process.exit(2);
}
if (!existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  console.error(`FATAL: build output missing at ${EXT_PATH} — run the matching wxt build first`);
  process.exit(2);
}

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/llms.txt') {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`# Fixture llms.txt\n\n- [Official Dup Fixture](http://127.0.0.1:${port}/official-dup.md)\n`);
    return;
  }
  if (u.pathname === '/official-dup.md') {
    res.setHeader('content-type', 'text/markdown; charset=utf-8');
    res.end(OFFICIAL_MD);
    return;
  }
  const html = FIXTURES[u.pathname];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.statusCode = html ? 200 : 404;
  res.end(html || 'not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`fixture server: http://127.0.0.1:${port}`);
console.log(`chrome:         ${chromePath}`);
console.log(`extension:      ${EXT_PATH}`);

async function launch(headless) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless,
    // Pipe transport is reliable on Windows and dies on GitHub's Linux runners
    // the moment an extension is loaded; WebSocket works on both.
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

// Extract one URL through the real pipeline: the exact two-step executeScript
// sequence the background performs, result read from storage.session.
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

try {
  const tab = await browser.newPage();
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 20000 },
  );
  const sw = await swTarget.worker();
  check('service worker target found', Boolean(sw), swTarget.url());

  const base = `http://127.0.0.1:${port}`;

  // 1. h1 == title (the #8 shape): exactly one H1 in the output.
  {
    const r = await extract(tab, sw, `${base}/dup`);
    // The fixture h1 carries whitespace noise, so count===1 also proves the
    // comparison squeezes rather than string-comparing raw text.
    const n = countExactLine(r.markdown, '# Example Fixture Domain');
    check('dup: exactly one "# Example Fixture Domain"', n === 1, `count=${n}`);
    check('dup: section heading survives', countExactLine(r.markdown, '## Section') === 1);
    check(
      'dup: quality.headings counts only emitted headings',
      r.quality?.headings === 1,
      `headings=${r.quality?.headings}`,
    );
    console.log(`--- /dup body head ---\n${headOf(r.markdown)}\n---`);
  }

  // 2. h1 != title: nothing may be removed.
  {
    const r = await extract(tab, sw, `${base}/distinct`);
    check(
      'distinct: synthetic title heading present',
      countExactLine(r.markdown, '# Fixture Manual — Page2AI Docs') === 1,
    );
    check(
      'distinct: page own h1 survives',
      countExactLine(r.markdown, '# Fixture Manual') === 1,
    );
  }

  // 3. The window closes at the first heading: a later identical heading is content.
  {
    const r = await extract(tab, sw, `${base}/later-dup`);
    check(
      'later-dup: exactly one "# Release Notes"',
      countExactLine(r.markdown, '# Release Notes') === 1,
      `count=${countExactLine(r.markdown, '# Release Notes')}`,
    );
    check(
      'later-dup: later identical "## Release Notes" survives',
      countExactLine(r.markdown, '## Release Notes') === 1,
    );
  }

  // 4. Markdown escaping must not defeat the comparison (textContent match).
  {
    const r = await extract(tab, sw, `${base}/escaped`);
    const synthetic = countExactLine(r.markdown, '# Dup *Title* [beta]');
    const body = stripFrontmatter(r.markdown);
    const escapedVariant = body.split('\n').some((l) => /^#\s+Dup \\\*Title\\\*/.test(l.trim()));
    check('escaped: synthetic heading present once', synthetic === 1, `count=${synthetic}`);
    check('escaped: escaped duplicate h1 removed', !escapedVariant);
  }

  // 5. Empty title: the window never opens; the fallback heading and an h1
  //    that happens to equal it must BOTH render (over-removal guard).
  {
    const r = await extract(tab, sw, `${base}/empty-title`);
    const n = countExactLine(r.markdown, '# Untitled page');
    check('empty-title: no dedupe against the fallback (both render)', n === 2, `count=${n}`);
  }

  // 6. Official-markdown short path: the mirror's own leading H1 is dropped too.
  {
    const r = await extract(tab, sw, `${base}/official-dup`, {
      overrides: { officialMarkdownMode: 'page-specific' },
    });
    check('official: short path engaged', r.status === 'official-md', `status=${r.status}`);
    const n = countExactLine(r.markdown, '# Official Dup Fixture');
    check('official: exactly one "# Official Dup Fixture"', n === 1, `count=${n}`);
    console.log(`--- /official-dup body head ---\n${headOf(r.markdown)}\n---`);
  }

  // 7. Live half — the two URLs named in #8. Needs the real-test build.
  if (LIVE) {
    {
      const r = await extract(tab, sw, 'https://example.com/');
      const n = countExactLine(r.markdown, '# Example Domain');
      check('live example.com: exactly one "# Example Domain"', n === 1, `count=${n}`);
      console.log(`--- example.com body head ---\n${headOf(r.markdown)}\n---`);
    }
    {
      const r = await extract(tab, sw, 'https://www.iana.org/help/example-domains');
      const t = (r.markdown.match(/^title: "(.*)"$/m) || [])[1] || '';
      const n = t ? countExactLine(r.markdown, `# ${t}`) : -1;
      check('live iana.org: exactly one title-equal H1', n === 1, `title="${t}" count=${n}`);
      console.log(`--- iana.org body head ---\n${headOf(r.markdown)}\n---`);
    }
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
